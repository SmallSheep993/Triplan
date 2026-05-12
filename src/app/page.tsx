"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type {
  DestinationSuggestion,
  ItineraryPlan,
  PlanStyle,
  TripRequest,
} from "@/lib/types";

const DEFAULT_REQUEST: TripRequest = {
  destination: "",
  days: 1,
  budget: 100,
  interests: [],
  pace: "balanced",
};

/** Parses comma-separated interests; accepts English and Chinese commas while typing stays raw in UI. */
function parseInterestsInput(raw: string): string[] {
  return raw
    .replace(/，/g, ",")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

interface PlanApiResponse {
  plans: ItineraryPlan[];
}

const STYLE_TABS: { key: PlanStyle; label: string; description: string }[] = [
  { key: "explorer", label: "Explorer", description: "More sights, more movement." },
  { key: "comfort", label: "Comfort", description: "Relaxed pace with extra breaks." },
  { key: "foodie", label: "Foodie", description: "Top dining spots with local flavor." },
];

export default function HomePage() {
  const [request, setRequest] = useState<TripRequest>(DEFAULT_REQUEST);
  const [daysInput, setDaysInput] = useState("");
  const [budgetInput, setBudgetInput] = useState("");
  const [interestsInput, setInterestsInput] = useState("");
  const [plans, setPlans] = useState<ItineraryPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [activeStyle, setActiveStyle] = useState<PlanStyle>("explorer");
  const [destinationInput, setDestinationInput] = useState(DEFAULT_REQUEST.destination);
  const [destinationSuggestions, setDestinationSuggestions] = useState<
    DestinationSuggestion[]
  >([]);
  const [selectedDestination, setSelectedDestination] =
    useState<DestinationSuggestion | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const trimmed = destinationInput.trim();
    if (trimmed.length < 2 || selectedDestination?.label === trimmed) {
      setDestinationSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const response = await fetch(
          `/api/destination-suggestions?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as {
          suggestions?: DestinationSuggestion[];
        };
        setDestinationSuggestions(data.suggestions ?? []);
      } catch {
        setDestinationSuggestions([]);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destinationInput, selectedDestination?.label]);

  function handleDestinationSelect(suggestion: DestinationSuggestion) {
    setSelectedDestination(suggestion);
    setDestinationInput(suggestion.label);
    setRequest((prev) => ({
      ...prev,
      destination: suggestion.secondaryText,
    }));
    setDestinationSuggestions([]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDestination) {
      setError("Please choose a destination from suggestions to avoid ambiguity.");
      inputRef.current?.focus();
      return;
    }

    const parsedDays = Number(daysInput);
    const parsedBudget = Number(budgetInput);
    if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 14) {
      setError("Trip length must be an integer between 1 and 14.");
      return;
    }
    if (!Number.isFinite(parsedBudget) || parsedBudget < 100) {
      setError("Total budget must be at least 100 USD.");
      return;
    }

    const interests = parseInterestsInput(interestsInput);

    const payload: TripRequest = {
      ...request,
      days: parsedDays,
      budget: parsedBudget,
      interests,
    };

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

        <div className="planner-layout">
          <form className="planner-form" onSubmit={handleSubmit}>
            <label className="field field-area-destination">
              <span>Destination</span>
              <div className="destination-picker">
                <input
                  ref={inputRef}
                  placeholder="Search city, region, or country"
                  value={destinationInput}
                  onChange={(e) => {
                    setDestinationInput(e.target.value);
                    setSelectedDestination(null);
                    setRequest((prev) => ({
                      ...prev,
                      destination: e.target.value,
                    }));
                  }}
                />
                {isLoadingSuggestions ? (
                  <p className="destination-hint">Searching destinations...</p>
                ) : null}
                {!selectedDestination ? (
                  <p className="destination-hint">
                    Choose a suggestion to confirm the exact location.
                  </p>
                ) : (
                  <p className="destination-confirmed">
                    Selected destination: <strong>{selectedDestination.secondaryText}</strong>
                  </p>
                )}
                {destinationSuggestions.length > 0 ? (
                  <ul className="destination-suggestions">
                    {destinationSuggestions.map((suggestion) => (
                      <li key={suggestion.placeId}>
                        <button
                          type="button"
                          onClick={() => handleDestinationSelect(suggestion)}
                        >
                          <span>{suggestion.label}</span>
                          <small>{suggestion.secondaryText}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <small className="field-help">
                Start typing and select one suggested location to avoid duplicate place names.
              </small>
            </label>

            <label className="field field-area-trip">
              <span>Trip Length (days)</span>
              <input
                type="number"
                min={1}
                max={14}
                value={daysInput}
                onChange={(e) => {
                  setDaysInput(e.target.value);
                }}
              />
              <small className="field-help">Recommended: 3-7 days for balanced plans.</small>
            </label>

            <label className="field field-area-budget">
              <span>Total Budget (USD)</span>
              <input
                type="number"
                min={100}
                value={budgetInput}
                onChange={(e) => {
                  setBudgetInput(e.target.value);
                }}
              />
              <small className="field-help">
                Enter the total trip budget for all days combined.
              </small>
            </label>

            <label className="field field-area-interests">
              <span>Interests (optional)</span>
              <input
                placeholder="e.g. food, museums, city walk, nature"
                value={interestsInput}
                onChange={(e) => setInterestsInput(e.target.value)}
              />
              <small className="field-help">
                Comma-separated. Leave blank for a balanced mix of popular spots at your destination.
              </small>
            </label>

            <label className="field field-area-pace">
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
              <small className="field-help">
                Relaxed means fewer stops; packed fits more activities per day.
              </small>
            </label>

            <div className="actions field-area-actions">
              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? "Generating itineraries..." : "Generate Itineraries"}
              </button>
            </div>
          </form>

          <aside className="planner-tips">
            <div className="tips-card">
              <h3>Quick Start</h3>
              <ol>
                <li>Search destination and select one suggestion.</li>
                <li>Set your trip length and total budget.</li>
                <li>Optional: add interests to sharpen recommendations.</li>
                <li>Generate and compare three itinerary styles.</li>
              </ol>
            </div>

            <div className="tips-card">
              <h3>Example Input</h3>
              <p>
                <strong>Destination:</strong> Tokyo, Japan
              </p>
              <p>
                <strong>Days:</strong> 4
              </p>
              <p>
                <strong>Budget:</strong> 1200 USD
              </p>
              <p>
                <strong>Interests:</strong> food, culture, city walk
              </p>
              <p>
                <strong>Pace:</strong> Balanced
              </p>
            </div>
          </aside>
        </div>

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
                      {day.blocks.map((block, idx) => (
                        <li key={`${day.day}-${idx}-${block.start}`}>
                          <div className="slot-title">
                            <span>
                              {block.start} – {block.end}
                            </span>
                            <strong>${block.estimatedCost}</strong>
                          </div>
                          <p>{block.placeName}</p>
                          <small>{block.notes}</small>
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
