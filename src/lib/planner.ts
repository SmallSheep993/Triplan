import type {
  ItineraryBlock,
  ItineraryDay,
  ItineraryPlan,
  PlaceCandidate,
  PlanStyle,
  TripRequest,
} from "@/lib/types";
import { isNightOrientedInterests } from "@/lib/travelPrefs";
import { z } from "zod";

const STYLE_LABEL: Record<PlanStyle, string> = {
  explorer: "Explorer",
  comfort: "Comfort",
  foodie: "Foodie",
};

const STYLE_MULTIPLIER: Record<PlanStyle, number> = {
  explorer: 1.0,
  comfort: 0.9,
  foodie: 1.1,
};

/** Default: dinner-era coverage. Night-oriented interests push later. */
function eveningCutoffs(req: TripRequest): { minLastEnd: number; hardCap: number } {
  if (isNightOrientedInterests(req.interests)) {
    return { minLastEnd: 22 * 60, hardCap: 23 * 60 + 45 }; // 22:00, 23:45
  }
  return { minLastEnd: 19 * 60 + 30, hardCap: 22 * 60 + 30 }; // 19:30, 22:30
}

const MAX_BLOCKS_PER_DAY = 10;

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIME_LOOSE = /^(\d{1,2}):([0-5]\d)$/;

/** Accepts 9:30 or 09:30; returns normalized HH:mm or null. */
function normalizeTimeString(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(TIME_LOOSE);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const mm = parseInt(m[2]!, 10);
  if (h > 23 || mm > 59 || h < 0) return null;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const hhmmSchema = z
  .string()
  .transform((s) => normalizeTimeString(s))
  .refine((v): v is string => v !== null, { message: "start/end must be valid local times HH:mm" });

function parseMinutes(t: string): number {
  const n = normalizeTimeString(t);
  if (!n) return 0;
  const m = n.match(TIME_RE);
  if (!m) return 0;
  return parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
}

function formatMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
  const h = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const itineraryBlockSchema = z.object({
  start: hhmmSchema,
  end: hhmmSchema,
  placeKind: z.enum(["attraction", "restaurant"]),
  placeId: z.string().min(1),
  placeName: z.string().min(1),
  estimatedCost: z.number().min(0),
  notes: z.string().min(1),
});

const itineraryDaySchema = z.object({
  day: z.number().int().min(1),
  theme: z.string().min(1),
  blocks: z.array(itineraryBlockSchema).min(3).max(MAX_BLOCKS_PER_DAY),
  dailyBudget: z.number().min(0),
});

const itineraryPlanSchema = z.object({
  style: z.enum(["explorer", "comfort", "foodie"]),
  summary: z.string().min(1),
  totalEstimatedBudget: z.number().min(0),
  days: z.array(itineraryDaySchema).min(1),
});

const geminiPlansSchema = z.object({
  plans: z.array(itineraryPlanSchema).length(3),
});

function mixHash(parts: number[]): number {
  let h = 2166136261;
  for (const p of parts) h = Math.imul(h ^ p, 16777619);
  return Math.abs(h) >>> 0;
}

function pickPlaceByCategory(
  places: PlaceCandidate[],
  category: PlaceCandidate["category"],
  index: number,
): PlaceCandidate {
  const filtered = places.filter((p) => p.category === category);
  const n = Math.max(filtered.length, 1);
  return filtered[index % n] ?? places[0];
}

/** Sort by start, fix end<=start, nudge overlaps so blocks read as a single day timeline. */
function normalizeDayBlocks(day: ItineraryDay): ItineraryDay {
  const sorted = [...day.blocks].sort((a, b) => parseMinutes(a.start) - parseMinutes(b.start));
  const fixed: ItineraryBlock[] = [];
  let lastEnd = -1;
  for (const block of sorted) {
    let s = parseMinutes(block.start);
    let e = parseMinutes(block.end);
    if (e <= s) e = s + 30;
    if (lastEnd >= 0 && s < lastEnd) s = lastEnd + 15;
    if (e <= s) e = s + 30;
    lastEnd = e;
    fixed.push({
      ...block,
      start: formatMinutes(s),
      end: formatMinutes(e),
    });
  }
  const dailyBudget = fixed.reduce((sum, b) => sum + b.estimatedCost, 0);
  return { ...day, blocks: fixed, dailyBudget };
}

function extendDayBlocksToEvening(
  day: ItineraryDay,
  places: PlaceCandidate[],
  style: PlanStyle,
  styleIndex: number,
  planUsedPlaceIds: Set<string>,
  req: TripRequest,
): ItineraryDay {
  const cut = eveningCutoffs(req);
  const normalized = normalizeDayBlocks({ ...day, blocks: [...day.blocks] });
  let blocks = [...normalized.blocks];
  if (blocks.length === 0) return day;

  const dayUsed = new Set(blocks.map((b) => b.placeId));
  const h = mixHash([day.day, styleIndex, blocks.length, parseMinutes(blocks[0]!.start)]);

  const lastEndMin = (): number => parseMinutes(blocks[blocks.length - 1]!.end);

  let extra = 0;
  while (lastEndMin() < cut.minLastEnd && blocks.length < MAX_BLOCKS_PER_DAY && extra < 10) {
    extra++;
    const last = blocks[blocks.length - 1]!;
    const le = lastEndMin();
    let placeKind: ItineraryBlock["placeKind"];
    if (le >= 19 * 60) {
      placeKind = last.placeKind === "restaurant" ? "attraction" : "restaurant";
    } else if (le >= 16 * 60 + 30) {
      placeKind = "restaurant";
    } else {
      placeKind = last.placeKind === "attraction" ? "restaurant" : "attraction";
    }

    const strictPool = places.filter(
      (p) =>
        p.category === placeKind &&
        !dayUsed.has(p.id) &&
        !planUsedPlaceIds.has(p.id),
    );
    const dayPool = places.filter((p) => p.category === placeKind && !dayUsed.has(p.id));
    const anyPool = places.filter((p) => p.category === placeKind);
    const src =
      strictPool.length > 0 ? strictPool : dayPool.length > 0 ? dayPool : anyPool;
    const pick =
      src[mixHash([h, extra, placeKind === "restaurant" ? 1 : 2]) % Math.max(src.length, 1)] ??
      pickPlaceByCategory(places, placeKind, day.day * 41 + extra + styleIndex * 7);

    dayUsed.add(pick.id);
    planUsedPlaceIds.add(pick.id);

    const gap = 15 + ((h + extra * 9) % 30);
    let startM = parseMinutes(last.end) + gap;
    const dur =
      placeKind === "restaurant"
        ? 55 + ((h + extra * 19) % 50)
        : 35 + ((h + extra * 11) % 45);
    let endM = startM + dur;
    if (endM > cut.hardCap) endM = cut.hardCap;
    if (endM <= startM) {
      startM = Math.min(parseMinutes(last.end) + 10, cut.hardCap - 45);
      endM = Math.min(startM + 50, cut.hardCap);
    }

    blocks.push({
      start: formatMinutes(startM),
      end: formatMinutes(endM),
      placeKind,
      placeId: pick.id,
      placeName: pick.name,
      estimatedCost: Math.round(
        (placeKind === "restaurant" ? 44 : 20) * STYLE_MULTIPLIER[style],
      ),
      notes: isNightOrientedInterests(req.interests)
        ? `${STYLE_LABEL[style]} — Evening / late stretch: ${pick.reason ?? "Keeps the day active into the evening."}`
        : `${STYLE_LABEL[style]} — Evening stretch: ${pick.reason ?? "Extends the day through dinner time."}`,
    });
  }

  if (isNightOrientedInterests(req.interests)) {
    const hasLateStart = blocks.some((b) => parseMinutes(b.start) >= 21 * 60);
    if (!hasLateStart && blocks.length < MAX_BLOCKS_PER_DAY) {
      const last = blocks[blocks.length - 1]!;
      const placeKind: ItineraryBlock["placeKind"] = "restaurant";
      const strictPool = places.filter(
        (p) =>
          p.category === placeKind &&
          !dayUsed.has(p.id) &&
          !planUsedPlaceIds.has(p.id),
      );
      const dayPool = places.filter((p) => p.category === placeKind && !dayUsed.has(p.id));
      const anyPool = places.filter((p) => p.category === placeKind);
      const src =
        strictPool.length > 0 ? strictPool : dayPool.length > 0 ? dayPool : anyPool;
      const pick =
        src[mixHash([h, 999, 1]) % Math.max(src.length, 1)] ??
        pickPlaceByCategory(places, placeKind, day.day * 53 + styleIndex);

      dayUsed.add(pick.id);
      planUsedPlaceIds.add(pick.id);

      let startM = Math.max(21 * 60, parseMinutes(last.end) + 20);
      const dur = 85 + (h % 40);
      let endM = startM + dur;
      if (endM > cut.hardCap) endM = cut.hardCap;
      if (endM <= startM) {
        startM = Math.max(parseMinutes(last.end) + 15, 21 * 60);
        endM = Math.min(startM + 75, cut.hardCap);
      }

      blocks.push({
        start: formatMinutes(startM),
        end: formatMinutes(endM),
        placeKind,
        placeId: pick.id,
        placeName: pick.name,
        estimatedCost: Math.round(52 * STYLE_MULTIPLIER[style]),
        notes: `${STYLE_LABEL[style]} — Late slot (21:00+): ${pick.reason ?? "Matches night-owl / late evening preference."}`,
      });
    }
  }

  return normalizeDayBlocks({ ...day, blocks, dailyBudget: 0 });
}

function extendAllDaysToEvening(
  plan: ItineraryPlan,
  places: PlaceCandidate[],
  req: TripRequest,
): ItineraryPlan {
  const styleIndex = plan.style === "explorer" ? 0 : plan.style === "comfort" ? 1 : 2;
  const planUsed = new Set<string>();
  for (const d of plan.days) {
    for (const b of d.blocks) planUsed.add(b.placeId);
  }
  const newDays = plan.days.map((day) =>
    extendDayBlocksToEvening(day, places, plan.style, styleIndex, planUsed, req),
  );
  return recomputePlanBudgets({ ...plan, days: newDays });
}

function buildRuleDay(
  day: number,
  style: PlanStyle,
  req: TripRequest,
  places: PlaceCandidate[],
  styleIndex: number,
): ItineraryDay {
  const h = mixHash([
    day,
    styleIndex,
    style === "explorer" ? 11 : style === "comfort" ? 17 : 23,
    req.days,
    req.budget % 997,
  ]);

  const paceBlocks =
    req.pace === "relaxed" ? 3 : req.pace === "balanced" ? 4 : 5;
  const blockCount = Math.min(7, Math.max(3, paceBlocks + (h % 2)));

  const kinds: ItineraryBlock["placeKind"][] = [];
  for (let i = 0; i < blockCount; i++) {
    if (style === "foodie") {
      kinds.push((h + i * 5) % 4 === 1 || i === blockCount - 1 ? "restaurant" : "attraction");
    } else if (style === "comfort") {
      kinds.push(i % 4 === 2 ? "restaurant" : "attraction");
    } else {
      kinds.push(i % 3 === 1 ? "restaurant" : "attraction");
    }
  }
  if (!kinds.includes("restaurant")) kinds[Math.min(1, blockCount - 1)] = "restaurant";

  const cut = eveningCutoffs(req);
  let minuteCursor = (isNightOrientedInterests(req.interests) ? 540 : 480) + (h % 90);
  const blocks: ItineraryBlock[] = [];

  for (let i = 0; i < blockCount; i++) {
    const placeKind = kinds[i] ?? "attraction";
    const dur =
      placeKind === "restaurant"
        ? 40 + ((h + i * 17) % 55)
        : 55 + ((h + i * 31) % 80);
    const place = pickPlaceByCategory(places, placeKind, day * 11 + i * 3 + styleIndex * 7);
    const baseCost = placeKind === "restaurant" ? 32 : 20;
    const startM = minuteCursor;
    let endM = startM + dur;
    if (endM > cut.hardCap) endM = cut.hardCap;
    if (endM <= startM) endM = startM + 30;

    blocks.push({
      start: formatMinutes(startM),
      end: formatMinutes(endM),
      placeKind,
      placeId: place.id,
      placeName: place.name,
      estimatedCost: Math.round(baseCost * STYLE_MULTIPLIER[style]),
      notes: `${STYLE_LABEL[style]} — ${place.reason ?? "Rule-based pick for this time window"}`,
    });

    minuteCursor = endM + (12 + ((h + i * 13) % 35));
  }

  return normalizeDayBlocks({
    day,
    theme: `${req.destination} — Day ${day}`,
    blocks,
    dailyBudget: 0,
  });
}

function generateRuleBasedPlans(
  req: TripRequest,
  places: PlaceCandidate[],
): ItineraryPlan[] {
  const styles: PlanStyle[] = ["explorer", "comfort", "foodie"];

  return styles.map((style, styleIndex) => {
    const days = Array.from({ length: req.days }, (_, i) =>
      buildRuleDay(i + 1, style, req, places, styleIndex),
    );
    let plan: ItineraryPlan = {
      style,
      summary: `${STYLE_LABEL[style]} plan for a ${req.days}-day trip in ${req.destination}`,
      totalEstimatedBudget: 0,
      days,
    };
    plan = extendAllDaysToEvening(plan, places, req);
    plan = normalizePlanDays(plan);
    plan = sanitizePlanPlaces(plan, places);
    const total = plan.days.reduce((sum, d) => sum + d.dailyBudget, 0);

    return {
      ...plan,
      totalEstimatedBudget: total,
    };
  });
}

function recomputePlanBudgets(plan: ItineraryPlan): ItineraryPlan {
  const days = plan.days.map((day) => {
    const dailyBudget = day.blocks.reduce((sum, b) => sum + b.estimatedCost, 0);
    return { ...day, dailyBudget };
  });
  const totalEstimatedBudget = days.reduce((sum, d) => sum + d.dailyBudget, 0);
  return { ...plan, days, totalEstimatedBudget };
}

/** Fixes hallucinated IDs and duplicate venues within a single plan using the candidate pool. */
function sanitizePlanPlaces(plan: ItineraryPlan, candidates: PlaceCandidate[]): ItineraryPlan {
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const used = new Set<string>();

  function poolForKind(kind: ItineraryBlock["placeKind"]) {
    return candidates.filter((p) => p.category === kind);
  }

  const newDays = plan.days.map((day) => ({
    ...day,
    blocks: day.blocks.map((block) => {
      const known = byId.get(block.placeId);
      if (known && known.category === block.placeKind && !used.has(block.placeId)) {
        used.add(block.placeId);
        return block;
      }

      const next = poolForKind(block.placeKind).find((p) => !used.has(p.id));
      if (!next) {
        if (known && known.category === block.placeKind) used.add(block.placeId);
        return block;
      }
      used.add(next.id);
      const reason = !known
        ? "must use only IDs from the candidate list"
        : "avoid repeating the same venue within this itinerary";
      return {
        ...block,
        placeId: next.id,
        placeName: next.name,
        notes: `${STYLE_LABEL[plan.style]} — ${next.name}: ${next.reason ?? reason}`,
      };
    }),
  }));

  return recomputePlanBudgets(normalizePlanDays({ ...plan, days: newDays }));
}

function normalizePlanDays(plan: ItineraryPlan): ItineraryPlan {
  return {
    ...plan,
    days: plan.days.map((d) => normalizeDayBlocks(d)),
  };
}

function buildGeminiPrompt(req: TripRequest, places: PlaceCandidate[]): string {
  const simplifiedPlaces = places.slice(0, 36).map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    rating: place.rating,
    priceLevel: place.priceLevel ?? null,
    reason: place.reason ?? "",
  }));

  const interestRules =
    req.interests.length > 0
      ? [
          `User interests (prioritize themes, ordering, times of day, and notes): ${req.interests.join(", ")}.`,
          "Each block notes must tie the stop to an interest, the time window, or the day theme (not generic filler).",
        ]
      : [
          "No specific interests: diversify day themes (culture, food, nature, neighborhoods).",
          "Each block notes must briefly say why this time window and stop fit the pace.",
        ];

  const night = isNightOrientedInterests(req.interests);
  const eveningWindowRules = night
    ? [
        "- Each day's LAST block must end no earlier than 22:00 local time.",
        "- Include at least one block per full day with start time 21:00 or later (late dinner, cocktail bar, night-market-style dining, live music — only from Candidate places that fit placeKind).",
        "- For late-night / night-owl interests: the day must feel intentionally late (not afternoon-only); last block may end up to 23:45 when using restaurant or evening-suitable picks.",
        "- Times: strictly increasing starts, end > start, no overlaps; keep roughly 09:00–23:45 local.",
      ]
    : [
        "- Each day's LAST block must end no earlier than 19:30 local time (include evening dining or an evening activity). Aim for roughly 10–12 hours from the first block's start to the last block's end on full travel days.",
        "- Times must be realistic same-day timeline: strictly increasing starts, end > start, no overlapping intervals, stay roughly within 08:00–22:30 unless a late dinner ends shortly after.",
      ];

  return [
    "You are an expert travel itinerary planner. Return only valid JSON — no markdown fences, no commentary.",
    "",
    "Hard rules:",
    "- Output exactly 3 plans: styles explorer, comfort, foodie (one plan per style).",
    "- Each plan covers all requested trip days (day numbers 1..N matching the request).",
    "- Each day uses an array `blocks` (NOT fixed morning/lunch slots).",
    "- Each block MUST have: start, end (24h local time at destination, strings like \"09:30\"), placeKind (\"attraction\" or \"restaurant\" — MUST match the chosen candidate's category), placeId, placeName, estimatedCost, notes.",
    "- Per day: minimum 3 blocks, maximum 10 blocks. Vary block count and durations by pace: relaxed fewer/shorter bursts; packed more segments.",
    ...eveningWindowRules,
    "- NEVER reuse the same time grid across different days in the same plan (vary start times and segment lengths day to day).",
    "- The three plans should NOT copy identical schedules from each other — vary time windows and ordering where possible.",
    "- Use ONLY venues from Candidate places. placeId MUST match a candidate id; placeName should match that candidate's name.",
    "- Within EACH plan, never use the same placeId twice across all days.",
    "- Total estimated costs should roughly align with the trip budget and pace.",
    ...interestRules,
    "",
    "Style differentiation:",
    "- explorer: denser sightseeing windows, slightly earlier starts on some days, more attraction blocks.",
    night
      ? "- comfort: gentler daytime pacing but still schedule a clear 21:00+ block when candidates support it."
      : "- comfort: wider gaps between blocks and gentler pacing; still include a proper evening (no need for late-night outings past 22:30).",
    "- foodie: more restaurant blocks or longer meal windows; memorable dining notes.",
    "",
    `Trip request: ${JSON.stringify(req)}`,
    `Candidate places: ${JSON.stringify(simplifiedPlaces)}`,
    "",
    "Output schema (example shape — use real counts for days and blocks):",
    JSON.stringify(
      {
        plans: [
          {
            style: "explorer",
            summary: "string",
            totalEstimatedBudget: 0,
            days: [
              {
                day: 1,
                theme: "string",
                dailyBudget: 0,
                blocks: [
                  {
                    start: "09:00",
                    end: "11:30",
                    placeKind: "attraction",
                    placeId: "string",
                    placeName: "string",
                    estimatedCost: 0,
                    notes: "string",
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n");
}

async function generateWithGemini(
  req: TripRequest,
  places: PlaceCandidate[],
): Promise<ItineraryPlan[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const response = await fetch(
    `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.78,
          responseMimeType: "application/json",
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildGeminiPrompt(req, places) }],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini returned empty response");

  const parsed = JSON.parse(raw) as unknown;
  const validated = geminiPlansSchema.parse(parsed);

    return validated.plans.map((plan) => {
      const rounded: ItineraryPlan = {
        ...plan,
        totalEstimatedBudget: Math.round(plan.totalEstimatedBudget),
        days: plan.days.map((day) => ({
          ...day,
          dailyBudget: Math.round(day.dailyBudget),
          blocks: day.blocks.map((block) => ({
            ...block,
            estimatedCost: Math.round(block.estimatedCost),
          })),
        })),
      };
      let out = sanitizePlanPlaces(normalizePlanDays(rounded), places);
      out = extendAllDaysToEvening(out, places, req);
      out = normalizePlanDays(out);
      out = sanitizePlanPlaces(out, places);
      return out;
    });
}

export async function generateMultiStylePlans(
  req: TripRequest,
  places: PlaceCandidate[],
): Promise<ItineraryPlan[]> {
  try {
    return await generateWithGemini(req, places);
  } catch (error) {
    console.error("Gemini planning failed, falling back to rule-based plan:", error);
    return generateRuleBasedPlans(req, places);
  }
}
