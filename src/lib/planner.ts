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

function pickPlace(
  places: PlaceCandidate[],
  slot: ItineraryItem["slot"],
  index: number,
): PlaceCandidate {
  const category = slot === "lunch" || slot === "dinner" ? "restaurant" : "attraction";
  const filtered = places.filter((p) => p.category === category);
  return filtered[index % Math.max(filtered.length, 1)] ?? places[0];
}

function buildDay(
  day: number,
  style: PlanStyle,
  req: TripRequest,
  places: PlaceCandidate[],
): ItineraryDay {
  const items = slots.map((slot, idx) => {
    const place = pickPlace(places, slot, day + idx);
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

  return styles.map((style) => {
    const days = Array.from({ length: req.days }, (_, i) =>
      buildDay(i + 1, style, req, places),
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

function buildGeminiPrompt(req: TripRequest, places: PlaceCandidate[]): string {
  const simplifiedPlaces = places.slice(0, 36).map((place) => ({
    id: place.id,
    name: place.name,
    category: place.category,
    rating: place.rating,
    priceLevel: place.priceLevel ?? null,
    reason: place.reason ?? "",
  }));

  return [
    "You are an itinerary planner API.",
    "Return only valid JSON with no markdown and no extra text.",
    "Create exactly 3 plans with styles explorer, comfort, foodie.",
    "Each day must have exactly 4 items: morning, lunch, afternoon, dinner.",
    "Estimated costs should roughly respect the total budget.",
    "Use only places from the provided candidate list.",
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
          temperature: 0.4,
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

  return validated.plans.map((plan) => ({
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
  }));
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
