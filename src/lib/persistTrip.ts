import type { ItineraryPlan, TripRequest } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PersistPlansResult =
  | { ok: true; tripId: string }
  | { ok: false; reason: string };

async function deleteTripCascade(sb: SupabaseClient, tripId: string) {
  await sb.from("trips").delete().eq("id", tripId);
}

/**
 * Saves trip + three itinerary graphs to Supabase. Uses service role (bypasses RLS).
 * On any failure after `trips` insert, deletes the trip row so children cascade away.
 */
export async function persistGeneratedPlans(
  tripRequest: TripRequest,
  plans: ItineraryPlan[],
): Promise<PersistPlansResult> {
  const client = createSupabaseAdminClient();
  if (!client) {
    return { ok: false, reason: "Supabase credentials not configured" };
  }

  const { data: tripRow, error: tripErr } = await client
    .from("trips")
    .insert({
      destination: tripRequest.destination,
      days: tripRequest.days,
      budget: tripRequest.budget,
      interests: tripRequest.interests,
      pace: tripRequest.pace,
    })
    .select("id")
    .single();

  if (tripErr || !tripRow?.id) {
    return {
      ok: false,
      reason: tripErr?.message ?? "Failed to insert trip",
    };
  }

  const tripId = tripRow.id as string;

  for (const plan of plans) {
    const { data: versionRow, error: versionErr } = await client
      .from("itinerary_versions")
      .insert({
        trip_id: tripId,
        style: plan.style,
        summary: plan.summary,
        total_estimated_budget: plan.totalEstimatedBudget,
      })
      .select("id")
      .single();

    if (versionErr || !versionRow?.id) {
      await deleteTripCascade(client, tripId);
      return {
        ok: false,
        reason: versionErr?.message ?? "Failed to insert itinerary version",
      };
    }

    const versionId = versionRow.id as string;

    const daysPayload = plan.days.map((d) => ({
      itinerary_version_id: versionId,
      day_number: d.day,
      theme: d.theme,
      daily_budget: d.dailyBudget,
    }));

    const { data: dayRows, error: daysErr } = await client
      .from("itinerary_days")
      .insert(daysPayload)
      .select("id");

    if (
      daysErr ||
      !dayRows ||
      dayRows.length !== plan.days.length
    ) {
      await deleteTripCascade(client, tripId);
      return {
        ok: false,
        reason: daysErr?.message ?? "Failed to insert itinerary days",
      };
    }

    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i]!;
      const dayRow = dayRows[i];
      const dayId = dayRow?.id as string | undefined;
      if (!dayId) {
        await deleteTripCascade(client, tripId);
        return { ok: false, reason: "Missing itinerary day id after insert" };
      }

      const itemsPayload = day.blocks.map((b) => ({
        itinerary_day_id: dayId,
        start_time: b.start,
        end_time: b.end,
        place_kind: b.placeKind,
        place_id: b.placeId,
        place_name: b.placeName,
        estimated_cost: b.estimatedCost,
        notes: b.notes,
      }));

      const { error: itemsErr } = await client.from("itinerary_items").insert(itemsPayload);

      if (itemsErr) {
        await deleteTripCascade(client, tripId);
        return {
          ok: false,
          reason: itemsErr.message ?? "Failed to insert itinerary items",
        };
      }
    }
  }

  return { ok: true, tripId };
}
