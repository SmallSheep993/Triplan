"use client";

import { FormEvent, useState } from "react";
import type { ItineraryPlan, TripRequest } from "@/lib/types";

const DEFAULT_REQUEST: TripRequest = {
  destination: "Tokyo",
  days: 4,
  budget: 600,
  interests: ["food", "city walk"],
  pace: "balanced",
};

interface PlanApiResponse {
  plans: ItineraryPlan[];
}

export default function HomePage() {
  const [request, setRequest] = useState<TripRequest>(DEFAULT_REQUEST);
  const [plans, setPlans] = useState<ItineraryPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      const data = (await response.json()) as PlanApiResponse & { message?: string };
      if (!response.ok) throw new Error(data.message ?? "Request failed");
      setPlans(data.plans);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Triplan</h1>
      <p>Enter your destination and preferences to generate 3 itinerary styles.</p>

      <form className="card" onSubmit={handleSubmit}>
        <p>
          Destination:
          <input
            value={request.destination}
            onChange={(e) => setRequest({ ...request, destination: e.target.value })}
          />
        </p>
        <p>
          Days:
          <input
            type="number"
            min={1}
            max={14}
            value={request.days}
            onChange={(e) =>
              setRequest({ ...request, days: Number.parseInt(e.target.value, 10) || 1 })
            }
          />
        </p>
        <p>
          Budget (USD):
          <input
            type="number"
            min={100}
            value={request.budget}
            onChange={(e) =>
              setRequest({ ...request, budget: Number.parseInt(e.target.value, 10) || 100 })
            }
          />
        </p>
        <p>
          Interests (comma-separated):
          <input
            value={request.interests.join(",")}
            onChange={(e) =>
              setRequest({
                ...request,
                interests: e.target.value
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        </p>
        <p>
          Pace:
          <select
            value={request.pace}
            onChange={(e) =>
              setRequest({ ...request, pace: e.target.value as TripRequest["pace"] })
            }
          >
            <option value="relaxed">Relaxed</option>
            <option value="balanced">Balanced</option>
            <option value="packed">Packed</option>
          </select>
        </p>
        <button type="submit" disabled={loading}>
          {loading ? "Generating..." : "Generate Itinerary"}
        </button>
      </form>

      {error ? <p style={{ color: "crimson" }}>Error: {error}</p> : null}

      {plans.map((plan) => (
        <section className="card" key={plan.style} style={{ marginTop: 16 }}>
          <h2>{plan.summary}</h2>
          <p>Estimated total budget: ${plan.totalEstimatedBudget}</p>
          {plan.days.map((day) => (
            <article key={`${plan.style}-${day.day}`}>
              <h3>{day.theme}</h3>
              <ul>
                {day.items.map((item) => (
                  <li key={`${day.day}-${item.slot}`}>
                    {item.slot} - {item.placeName} (${item.estimatedCost}) - {item.notes}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
