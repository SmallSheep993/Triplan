# Website
https://triplan-993.vercel.app/

# Triplan

Triplan is an AI travel planner that generates personalized itineraries in multiple styles based on destination, trip length, budget, interests, and travel pace.

## Tech Stack

- Next.js (App Router) + TypeScript
- Google Places API (destination suggestions + place candidates)
- Gemini API (structured itinerary generation)
- Zod (runtime schema validation)
- Supabase (schema prepared for persistence)

## Current Features

- Destination disambiguation with suggestion selection (prevents ambiguous place names)
- Empty-first form input (users manually enter values)
- Editable numeric fields for days and budget (can be fully cleared and retyped)
- Three itinerary styles per request: `explorer`, `comfort`, `foodie`
- Daily plans use flexible time blocks (`start`–`end`) with 3–10 segments per day; **evening coverage** targets last end ≥ **19:30** by default, or **22:00+** with a **21:00+** block when interests indicate night-owl / nightlife (see `travelPrefs.ts`).
- Responsive UI with quick-start guidance and example input panel
- Rule-based fallback if Gemini generation fails

## API Flow

1. User searches and confirms a destination from suggestions.
2. Backend calls Google Places API to fetch attraction and restaurant candidates.
3. Backend sends trip request + candidates to Gemini for JSON itinerary generation.
4. Backend validates the model output with Zod and returns plans to the UI.
5. If Gemini fails, the backend falls back to rule-based generation.

## API Endpoints

- `GET /api/destination-suggestions?q=...`
  - Returns destination suggestions from Google Places.
- `POST /api/plan`
  - Generates three itinerary styles from user preferences.

## Project Structure

- `src/app/page.tsx` - main planner UI
- `src/app/api/destination-suggestions/route.ts` - destination suggestion API
- `src/app/api/plan/route.ts` - itinerary generation API
- `src/lib/providers.ts` - Google Places provider logic
- `src/lib/planner.ts` - Gemini planner + fallback logic
- `src/lib/types.ts` - shared types
- `supabase/schema.sql` - database schema draft

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in:

- `GEMINI_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `SUPABASE_URL` (optional for current MVP runtime)
- `SUPABASE_ANON_KEY` (optional for current MVP runtime)
- `SUPABASE_SERVICE_ROLE_KEY` (optional for current MVP runtime)

## Quick API Test

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

## Next Improvements

- Persist generated trips to Supabase
- Add regenerate-one-day and replace-place interactions
- Add budget balancing and place diversity constraints
- Improve Gemini prompt and retry strategy for rate-limit handling

