import type { PlaceCandidate, TripRequest } from "@/lib/types";

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  priceLevel?: number;
}

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

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

function buildFallbackCandidates(req: TripRequest): PlaceCandidate[] {
  const attractions = FALLBACK_ATTRACTIONS.map((name, i) => ({
    id: `a-${i + 1}`,
    name: `${req.destination} ${name}`,
    category: "attraction" as const,
    rating: 4.2 + (i % 3) * 0.2,
    priceLevel: 1 + (i % 3),
    reason: "Matches your interests",
  }));

  const restaurants = FALLBACK_RESTAURANTS.map((name, i) => ({
    id: `r-${i + 1}`,
    name: `${req.destination} ${name}`,
    category: "restaurant" as const,
    rating: 4.1 + (i % 3) * 0.2,
    priceLevel: 1 + (i % 4),
    reason: "Highly rated and easy to reach",
  }));

  return [...attractions, ...restaurants];
}

async function searchGooglePlaces(params: {
  apiKey: string;
  textQuery: string;
  includedType: "restaurant" | "tourist_attraction";
}): Promise<GooglePlace[]> {
  const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": params.apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.rating,places.priceLevel",
    },
    body: JSON.stringify({
      textQuery: params.textQuery,
      includedType: params.includedType,
      languageCode: "en",
      pageSize: 10,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Places request failed (${response.status}): ${detail}`);
  }

  const data = (await response.json()) as { places?: GooglePlace[] };
  return data.places ?? [];
}

function toCandidate(
  place: GooglePlace,
  category: PlaceCandidate["category"],
): PlaceCandidate | null {
  if (!place.id || !place.displayName?.text) return null;

  return {
    id: place.id,
    name: place.displayName.text,
    category,
    rating: place.rating ?? 4.0,
    priceLevel: place.priceLevel,
    reason:
      category === "restaurant"
        ? "Selected from Google Places dining results"
        : "Selected from Google Places attraction results",
  };
}

function dedupeCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const unique = new Map<string, PlaceCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.id)) unique.set(candidate.id, candidate);
  }
  return [...unique.values()];
}

export async function fetchPlaceCandidates(
  req: TripRequest,
): Promise<PlaceCandidate[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return buildFallbackCandidates(req);

  try {
    const interestsText = req.interests.join(", ");
    const [attractionResults, restaurantResults] = await Promise.all([
      searchGooglePlaces({
        apiKey,
        textQuery: `${req.destination} best attractions ${interestsText}`,
        includedType: "tourist_attraction",
      }),
      searchGooglePlaces({
        apiKey,
        textQuery: `${req.destination} best restaurants ${interestsText}`,
        includedType: "restaurant",
      }),
    ]);

    const mapped = dedupeCandidates([
      ...attractionResults
        .map((place) => toCandidate(place, "attraction"))
        .filter((value): value is PlaceCandidate => value !== null),
      ...restaurantResults
        .map((place) => toCandidate(place, "restaurant"))
        .filter((value): value is PlaceCandidate => value !== null),
    ]);

    if (mapped.length < 4) return buildFallbackCandidates(req);
    return mapped;
  } catch (error) {
    console.error("Falling back to local candidates:", error);
    return buildFallbackCandidates(req);
  }
}
