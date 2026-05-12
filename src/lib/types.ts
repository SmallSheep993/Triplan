export type TravelPace = "relaxed" | "balanced" | "packed";
export type PlanStyle = "explorer" | "comfort" | "foodie";

export interface TripRequest {
  destination: string;
  days: number;
  budget: number;
  interests: string[];
  pace: TravelPace;
}

export interface DestinationSuggestion {
  placeId: string;
  label: string;
  secondaryText: string;
}

export interface PlaceCandidate {
  id: string;
  name: string;
  category: "attraction" | "restaurant";
  rating: number;
  priceLevel?: number;
  reason?: string;
}

/** Local time window (24h, destination). placeKind must match candidate category. */
export interface ItineraryBlock {
  start: string;
  end: string;
  placeKind: "attraction" | "restaurant";
  placeId: string;
  placeName: string;
  estimatedCost: number;
  notes: string;
}

export interface ItineraryDay {
  day: number;
  theme: string;
  blocks: ItineraryBlock[];
  dailyBudget: number;
}

export interface ItineraryPlan {
  style: PlanStyle;
  summary: string;
  totalEstimatedBudget: number;
  days: ItineraryDay[];
}
