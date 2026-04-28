"use client";

import { FormEvent, useState } from "react";
import type { ItineraryItem, ItineraryPlan, PlanStyle, TripRequest } from "@/lib/types";

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

const STYLE_TABS: { key: PlanStyle; label: string; description: string }[] = [
  { key: "explorer", label: "Explorer", description: "More sights, more movement." },
  { key: "comfort", label: "Comfort", description: "Relaxed pace with extra breaks." },
  { key: "foodie", label: "Foodie", description: "Top dining spots with local flavor." },
];

const SLOT_LABEL: Record<ItineraryItem["slot"], string> = {
  morning: "Morning",
  lunch: "Lunch",
  afternoon: "Afternoon",
  dinner: "Dinner",
};

export default function HomePage() {
  const [request, setRequest] = useState<TripRequest>(DEFAULT_REQUEST);
  const [plans, setPlans] = useState<ItineraryPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [activeStyle, setActiveStyle] = useState<PlanStyle>("explorer");

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
      setActiveStyle(data.plans[0]?.style ?? "explorer");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const currentPlan = plans.find((plan) => plan.style === activeStyle);

  return (
    <main className="page">
      <section className="hero">
        <p className="hero-badge">AI Travel Planner</p>
        <h1>Plan your perfect trip in seconds</h1>
        <p className="hero-subtitle">
          Build personalized itineraries with multiple styles based on your destination,
          budget, and interests.
        </p>
      </section>

      <section className="card planner-card">
        <div className="section-header">
          <h2>Trip Preferences</h2>
          <p>Fill in your travel details and generate tailored plans.</p>
        </div>

        <form className="planner-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Destination</span>
            <input
              placeholder="e.g. Tokyo, Kyoto, Paris"
              value={request.destination}
              onChange={(e) => setRequest({ ...request, destination: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Trip Length (days)</span>
            <input
              type="number"
              min={1}
              max={14}
              value={request.days}
              onChange={(e) =>
                setRequest({ ...request, days: Number.parseInt(e.target.value, 10) || 1 })
              }
            />
          </label>

          <label className="field">
            <span>Total Budget (USD)</span>
            <input
              type="number"
              min={100}
              value={request.budget}
              onChange={(e) =>
                setRequest({ ...request, budget: Number.parseInt(e.target.value, 10) || 100 })
              }
            />
          </label>

          <label className="field">
            <span>Interests</span>
            <input
              placeholder="e.g. food, museums, city walk, nature"
              value={request.interests.join(", ")}
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
          </label>

          <label className="field field-full">
            <span>Pace</span>
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
          </label>

          <div className="actions field-full">
            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? "Generating itineraries..." : "Generate Itineraries"}
            </button>
          </div>
        </form>

        {error ? <p className="error-text">Error: {error}</p> : null}
      </section>

      <section className="results">
        <div className="section-header">
          <h2>Generated Plans</h2>
          <p>Compare styles and choose the one that matches your travel mood.</p>
        </div>

        {plans.length === 0 && !loading ? (
          <div className="card empty-state">
            <h3>Ready to build your itinerary?</h3>
            <p>
              Submit your preferences to receive three AI-generated plan styles:
              Explorer, Comfort, and Foodie.
            </p>
          </div>
        ) : null}

        {loading ? (
          <div className="card loading-state">
            <div className="spinner" />
            <p>Generating your personalized travel plans...</p>
          </div>
        ) : null}

        {plans.length > 0 && currentPlan ? (
          <>
            <div className="tab-row">
              {STYLE_TABS.map((tab) => {
                const active = tab.key === activeStyle;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`tab-btn${active ? " active" : ""}`}
                    onClick={() => setActiveStyle(tab.key)}
                  >
                    <span>{tab.label}</span>
                    <small>{tab.description}</small>
                  </button>
                );
              })}
            </div>

            <article className="card plan-card">
              <header className="plan-header">
                <div>
                  <h3>{currentPlan.summary}</h3>
                  <p>{currentPlan.days.length} days planned</p>
                </div>
                <div className="budget-pill">
                  <span>Estimated Budget</span>
                  <strong>${currentPlan.totalEstimatedBudget}</strong>
                </div>
              </header>

              <div className="day-grid">
                {currentPlan.days.map((day) => (
                  <section key={`${currentPlan.style}-${day.day}`} className="day-card">
                    <h4>{day.theme}</h4>
                    <p className="day-budget">Daily budget: ${day.dailyBudget}</p>
                    <ul>
                      {day.items.map((item) => (
                        <li key={`${day.day}-${item.slot}`}>
                          <div className="slot-title">
                            <span>{SLOT_LABEL[item.slot]}</span>
                            <strong>${item.estimatedCost}</strong>
                          </div>
                          <p>{item.placeName}</p>
                          <small>{item.notes}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </article>
          </>
        ) : null}
      </section>
    </main>
  );
}
