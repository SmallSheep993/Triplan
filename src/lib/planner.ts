import type {
  ItineraryDay,
  ItineraryItem,
  ItineraryPlan,
  PlaceCandidate,
  PlanStyle,
  TripRequest,
} from "@/lib/types";
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

const slots: ItineraryItem["slot"][] = ["morning", "lunch", "afternoon", "dinner"];
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";

const itineraryItemSchema = z.object({
  slot: z.enum(["morning", "lunch", "afternoon", "dinner"]),
  placeId: z.string().min(1),
  placeName: z.string().min(1),
  estimatedCost: z.number().min(0),
  notes: z.string().min(1),
});

const itineraryDaySchema = z.object({
  day: z.number().int().min(1),
  theme: z.string().min(1),
  items: z.array(itineraryItemSchema).length(4),
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

function slotCategory(slot: ItineraryItem["slot"]): PlaceCandidate["category"] {
  return slot === "lunch" || slot === "dinner" ? "restaurant" : "attraction";
}

function pickPlace(
  places: PlaceCandidate[],
  slot: ItineraryItem["slot"],
  index: number,
  styleOffset: number,
): PlaceCandidate {
  const category = slotCategory(slot);
  const filtered = places.filter((p) => p.category === category);
  const n = Math.max(filtered.length, 1);
  return filtered[(index + styleOffset) % n] ?? places[0];
}

function buildDay(
  day: number,
  style: PlanStyle,
  req: TripRequest,
  places: PlaceCandidate[],
  styleOffset: number,
): ItineraryDay {
  const items = slots.map((slot, idx) => {
    const place = pickPlace(places, slot, day + idx, styleOffset);
    const baseCost = slot === "morning" || slot === "afternoon" ? 20 : 35;
    return {
      slot,
      placeId: place.id,
      placeName: place.name,
      estimatedCost: Math.round(baseCost * STYLE_MULTIPLIER[style]),
      notes: `${STYLE_LABEL[style]} style: ${place.reason ?? "Selected by rating and accessibility"}`,
    };
  });

  return {
    day,
    theme: `${req.destination} - Day ${day}`,
    items,
    dailyBudget: items.reduce((sum, item) => sum + item.estimatedCost, 0),
  };
}

function generateRuleBasedPlans(
  req: TripRequest,
  places: PlaceCandidate[],
): ItineraryPlan[] {
  const styles: PlanStyle[] = ["explorer", "comfort", "foodie"];

  return styles.map((style, styleIndex) => {
    const styleOffset = styleIndex * 4;
    const days = Array.from({ length: req.days }, (_, i) =>
      buildDay(i + 1, style, req, places, styleOffset),
    );
    const total = days.reduce((sum, d) => sum + d.dailyBudget, 0);

    return {
      style,
      summary: `${STYLE_LABEL[style]} plan for a ${req.days}-day trip in ${req.destination}`,
      totalEstimatedBudget: total,
      days,
    };
  });
}

function recomputePlanBudgets(plan: ItineraryPlan): ItineraryPlan {
  const days = plan.days.map((day) => {
    const dailyBudget = day.items.reduce((sum, i) => sum + i.estimatedCost, 0);
    return { ...day, dailyBudget };
  });
  const totalEstimatedBudget = days.reduce((sum, d) => sum + d.dailyBudget, 0);
  return { ...plan, days, totalEstimatedBudget };
}

/** Fixes hallucinated IDs and duplicate venues within a single plan using the candidate pool. */
function sanitizePlanPlaces(plan: ItineraryPlan, candidates: PlaceCandidate[]): ItineraryPlan {
  const byId = new Map(candidates.map((p) => [p.id, p]));
  const used = new Set<string>();

  function poolForSlot(slot: ItineraryItem["slot"]) {
    const cat = slotCategory(slot);
    return candidates.filter((p) => p.category === cat);
  }

  const newDays = plan.days.map((day) => ({
    ...day,
    items: day.items.map((item) => {
      const known = byId.get(item.placeId);
      if (known && !used.has(item.placeId)) {
        used.add(item.placeId);
        return item;
      }

      const next = poolForSlot(item.slot).find((p) => !used.has(p.id));
      if (!next) {
        if (known) used.add(item.placeId);
        return item;
      }
      used.add(next.id);
      const reason =
        !known
          ? "must use only IDs from the candidate list"
          : "avoid repeating the same venue within this itinerary";
      return {
        ...item,
        placeId: next.id,
        placeName: next.name,
        notes: `${STYLE_LABEL[plan.style]} — ${next.name}: ${next.reason ?? reason}`,
      };
    }),
  }));

  return recomputePlanBudgets({ ...plan, days: newDays });
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
          `User interests (prioritize these in themes, ordering, and notes): ${req.interests.join(", ")}.`,
          "Each notes field must briefly explain how that stop relates to at least one interest or to the day theme.",
        ]
      : [
          "No specific interests were provided: diversify themes across days (culture, nature, food, neighborhoods, classics).",
          "Each notes field must briefly say why this stop fits that day or travel pace.",
        ];

  return [
    "You are an expert travel itinerary planner. Return only valid JSON — no markdown fences, no commentary.",
    "",
    "Hard rules:",
    "- Output exactly 3 plans: styles explorer, comfort, foodie (one plan per style).",
    "- Each plan covers all requested days; each day has exactly 4 items with slots: morning, lunch, afternoon, dinner.",
    "- Use ONLY venues from Candidate places. Every placeId MUST match an id from that list exactly. Copy placeName from the list for consistency.",
    "- Within EACH plan, never use the same placeId twice (no duplicate venues across the whole trip for that plan).",
    "- Across the 3 plans, vary venue choices where possible so the three itineraries feel distinct, not copy-paste.",
    "- Align estimated costs with the trip budget and pace (lower density / fewer costly meals for relaxed pace).",
    "- Morning and afternoon slots = attraction category; lunch and dinner = restaurant category.",
    ...interestRules,
    "",
    "Style differentiation:",
    "- explorer: more sights and walking between distinct areas; energetic day themes.",
    "- comfort: fewer drastic moves, more breathing room; relaxed themes and practical notes.",
    "- foodie: emphasize memorable meals; lunch and dinner should feel special or highly local.",
    "",
    `Trip request: ${JSON.stringify(req)}`,
    `Candidate places: ${JSON.stringify(simplifiedPlaces)}`,
    "",
    "Output schema:",
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
                items: [
                  {
                    slot: "morning",
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
          temperature: 0.72,
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
        items: day.items.map((item) => ({
          ...item,
          estimatedCost: Math.round(item.estimatedCost),
        })),
      })),
    };
    return sanitizePlanPlaces(rounded, places);
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
