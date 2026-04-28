# Triplan MVP

A runnable MVP for an AI travel assistant. Enter destination, trip length, budget, and interests to generate 3 itinerary styles.

## 1. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`

## 2. Implemented features

- Frontend input form (destination/days/budget/interests/pace)
- Backend endpoint `POST /api/plan`
- Three itinerary styles: `explorer` / `comfort` / `foodie`
- Supabase SQL schema draft: `supabase/schema.sql`

## 3. Project structure

- `src/app/page.tsx`: MVP page
- `src/app/api/plan/route.ts`: itinerary generation endpoint
- `src/lib/providers.ts`: Google Places candidate provider
- `src/lib/planner.ts`: Gemini-based itinerary planning logic (with fallback)
- `src/lib/types.ts`: core types

## 4. Next steps for real APIs (recommended order)

### Step 1: Google Places

Replace `src/lib/providers.ts` with real Places queries and return normalized `PlaceCandidate[]`.

### Step 2: Gemini structured generation

Use Gemini JSON output in `src/lib/planner.ts`:

1. Generate day-level structure first (theme, budget)
2. Fill concrete slots (morning/lunch/afternoon/dinner)

Enforce strict JSON schema output.

### Step 3: Supabase persistence

After successful generation, write to:

1. `trips`
2. `itinerary_versions`
3. `itinerary_days`
4. `itinerary_items`

## 5. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `GEMINI_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## 6. Test the endpoint

```bash
curl -X POST http://localhost:3000/api/plan \
  -H "Content-Type: application/json" \
  -d '{
    "destination":"Kyoto",
    "days":3,
    "budget":500,
    "interests":["food","temple"],
    "pace":"balanced"
  }'
```

