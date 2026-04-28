export type TravelPace = "relaxed" | "balanced" | "packed";
export type PlanStyle = "explorer" | "comfort" | "foodie";

export interface TripRequest {
  destination: string;
  days: number;
  budget: number;
  interests: string[];
  pace: TravelPace;
}

export interface PlaceCandidate {
  id: string;
  name: string;
  category: "attraction" | "restaurant";
  rating: number;
  priceLevel?: number;
  reason?: string;
}

export interface ItineraryItem {
  slot: "morning" | "lunch" | "afternoon" | "dinner";
  placeId: string;
  placeName: string;
  estimatedCost: number;
  notes: string;
}

export interface ItineraryDay {
  day: number;
  theme: string;
  items: ItineraryItem[];
  dailyBudget: number;
}

export interface ItineraryPlan {
  style: PlanStyle;
  summary: string;
  totalEstimatedBudget: number;
  days: ItineraryDay[];
}
