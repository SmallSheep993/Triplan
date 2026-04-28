import { NextResponse } from "next/server";
import { z } from "zod";
import type { DestinationSuggestion } from "@/lib/types";

const querySchema = z.object({
  q: z.string().trim().min(2),
});

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";

interface GooglePlaceSearchResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = querySchema.parse({ q: searchParams.get("q") ?? "" });
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ suggestions: [] as DestinationSuggestion[] });
    }

    const response = await fetch(GOOGLE_PLACES_TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({
        textQuery: query.q,
        languageCode: "en",
        pageSize: 5,
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ suggestions: [] as DestinationSuggestion[] });
    }

    const data = (await response.json()) as { places?: GooglePlaceSearchResult[] };
    const suggestions: DestinationSuggestion[] = (data.places ?? [])
      .map((place) => {
        if (!place.id || !place.displayName?.text || !place.formattedAddress) {
          return null;
        }
        return {
          placeId: place.id,
          label: place.displayName.text,
          secondaryText: place.formattedAddress,
        };
      })
      .filter((value): value is DestinationSuggestion => value !== null);

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] as DestinationSuggestion[] });
  }
}
