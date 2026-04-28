import type { PlaceCandidate, TripRequest } from "@/lib/types";

const FALLBACK_ATTRACTIONS = [
  "Landmark Park",
  "History Museum",
  "Observation Deck",
  "Arts District",
];

const FALLBACK_RESTAURANTS = [
  "Local Favorite Bistro",
  "Top-Rated Signature Restaurant",
  "Street Food Market",
  "Skyline Dinner Bar",
];

export async function fetchPlaceCandidates(
  req: TripRequest,
): Promise<PlaceCandidate[]> {
  const attractions = FALLBACK_ATTRACTIONS.map((name, i) => ({
    id: `a-${i + 1}`,
    name: `${req.destination}${name}`,
    category: "attraction" as const,
    rating: 4.2 + (i % 3) * 0.2,
    priceLevel: 1 + (i % 3),
    reason: "Matches your interests",
  }));

  const restaurants = FALLBACK_RESTAURANTS.map((name, i) => ({
    id: `r-${i + 1}`,
    name: `${req.destination}${name}`,
    category: "restaurant" as const,
    rating: 4.1 + (i % 3) * 0.2,
    priceLevel: 1 + (i % 4),
    reason: "Highly rated and easy to reach",
  }));

  return [...attractions, ...restaurants];
}
