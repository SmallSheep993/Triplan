# Website
https://triplan-993.vercel.app/

# Triplan

Triplan is an AI travel planner that generates personalized itineraries in multiple styles based on destination, trip length, budget, interests, and travel pace.

## Tech Stack

- Next.js (App Router) + TypeScript
- Google Places API (destination suggestions + place candidates)
- Gemini API (structured itinerary generation)
- Zod (runtime schema validation)
- Supabase (PostgreSQL; itineraries persisted after `/api/plan` when service credentials are set)

## Current Features

- Destination disambiguation with suggestion selection (prevents ambiguous place names)
- Empty-first form input (users manually enter values)
- Editable numeric fields for days and budget (can be fully cleared and retyped)
- Three itinerary styles per request: `explorer`, `comfort`, `foodie`
- Daily plans use flexible time blocks (`start`–`end`) with 3–10 segments per day; **evening coverage** targets last end ≥ **19:30** by default, or **22:00+** with a **21:00+** block when interests indicate night-owl / nightlife (see `travelPrefs.ts`).
- Responsive UI with quick-start guidance and example input panel
- Rule-based fallback if Gemini generation fails
- After generation, trips can be **saved to Supabase**; the UI shows the save outcome (`tripId` on success or `persistDetails` when saving was skipped or failed)

## API Flow

1. User searches and confirms a destination from suggestions.
2. Backend calls Google Places API to fetch attraction and restaurant candidates.
3. Backend sends trip request + candidates to Gemini for JSON itinerary generation.
4. Backend validates the model output with Zod and returns plans to the UI.
5. If Gemini fails, the backend falls back to rule-based generation.
6. Backend writes the trip and all three itinerary styles to Supabase (service role). If persistence fails or env is missing, the API still returns `plans`; see response fields `persisted` / `persistDetails`.

## API Endpoints

- `GET /api/destination-suggestions?q=...`
  - Returns destination suggestions from Google Places.
- `POST /api/plan`
  - Generates three itinerary styles from user preferences.
  - Response includes `persisted` (boolean), optional `tripId`, and optional `persistDetails` when saving failed or was skipped.

## Project Structure

- `src/app/page.tsx` - main planner UI
- `src/app/api/destination-suggestions/route.ts` - destination suggestion API
- `src/app/api/plan/route.ts` - itinerary generation API
- `src/lib/supabase/admin.ts` - server Supabase client (service role)
- `src/lib/persistTrip.ts` - insert trip + itinerary rows
- `src/lib/providers.ts` - Google Places provider logic
- `src/lib/planner.ts` - Gemini planner + fallback logic
- `src/lib/types.ts` - shared types
- `supabase/schema.sql` - PostgreSQL schema; apply in Supabase (see below)

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Database (Supabase)

1. Create a Supabase project and open **SQL Editor**.
2. Run the full contents of **`supabase/schema.sql`** against your database (creates `trips`, `itinerary_versions`, `itinerary_days`, `itinerary_items`).
3. When the dashboard offers **Row Level Security (RLS)**, enabling it is recommended for safety; the app writes from the server using **`SUPABASE_SERVICE_ROLE_KEY`**, which bypasses RLS. Do **not** expose that key to the browser or commit it.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in values.

**Required for core travel generation**

| Variable               | Purpose                                      |
|------------------------|----------------------------------------------|
| `GEMINI_API_KEY`       | Itinerary JSON generation                    |
| `GOOGLE_MAPS_API_KEY`  | Destination suggestions + place candidates   |

**Required to persist trips to Supabase**

| Variable                        | Purpose                                                                 |
|---------------------------------|-------------------------------------------------------------------------|
| `SUPABASE_URL`                  | Project URL (e.g. `https://<ref>.supabase.co`, no `/rest/v1/` suffix) |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only key for inserts after `/api/plan`                         |

If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, itineraries still generate, but `persisted` will be `false` and `persistDetails` will explain the skip or error.

**Optional / reserved**

| Variable             | Notes                                                                 |
|----------------------|-----------------------------------------------------------------------|
| `SUPABASE_ANON_KEY`  | Not used by the current server persistence path; keep for future client-side Supabase use with RLS policies. |

## Deploying on Vercel

1. Connect the GitHub repo and use the default Next.js settings.
2. Add the same environment variables under **Project → Settings → Environment Variables** (Production / Preview as needed).
3. Never prefix `SUPABASE_SERVICE_ROLE_KEY` with `NEXT_PUBLIC_`; it must stay server-only.
4. Redeploy after changing variables so new builds pick them up.

## Quick API Test

For parity with the web app, use a **`destination`** string that matches what the UI sends after picking a suggestion (typically the **formatted address** from Google Places), not only a short city name.

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{
    "destination":"Tokyo, Japan",
    "days":4,
    "budget":1200,
    "interests":["food","culture","city walk"],
    "pace":"balanced"
  }'
```

Inspect `persisted`, `tripId`, and `persistDetails` in the JSON response.

## Next Improvements

- Add list/history page for saved trips from Supabase (`tripId`)
- Add regenerate-one-day and replace-place interactions
- Add budget balancing and place diversity constraints
- Improve Gemini prompt and retry strategy for rate-limit handling
