import type {
  ItineraryDay,
  ItineraryItem,
  ItineraryPlan,
  PlaceCandidate,
  PlanStyle,
  TripRequest,
} from "@/lib/types";

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

export function generateMultiStylePlans(
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
