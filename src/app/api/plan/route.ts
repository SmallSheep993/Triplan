import { NextResponse } from "next/server";
import { z } from "zod";
import { generateMultiStylePlans } from "@/lib/planner";
import { fetchPlaceCandidates } from "@/lib/providers";
import type { TripRequest } from "@/lib/types";

const tripRequestSchema = z.object({
  destination: z.string().min(1),
  days: z.number().int().min(1).max(14),
  budget: z.number().min(100),
  interests: z.array(z.string()).min(1),
  pace: z.enum(["relaxed", "balanced", "packed"]),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = tripRequestSchema.parse(body);

    const tripRequest: TripRequest = {
      destination: parsed.destination,
      days: parsed.days,
      budget: parsed.budget,
      interests: parsed.interests,
      pace: parsed.pace,
    };

    const placeCandidates = await fetchPlaceCandidates(tripRequest);
    const plans = await generateMultiStylePlans(tripRequest, placeCandidates);

    return NextResponse.json({
      tripRequest,
      generatedAt: new Date().toISOString(),
      plans,
      nextStep:
        "Enhance Gemini prompts and persist itineraries to Supabase.",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: "Invalid request parameters", issues: error.issues },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { message: "Failed to generate itinerary", detail: (error as Error).message },
      { status: 500 },
    );
  }
}
