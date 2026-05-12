/**
 * Detects interests that imply a later schedule (nightlife, late dining, night owl).
 * Avoids substring false positives (e.g. "knight" matching "night") via word boundaries / phrases.
 */
export function isNightOrientedInterests(interests: string[]): boolean {
  if (interests.length === 0) return false;
  const blob = interests.join(" ").toLowerCase();

  const phraseHits = [
    "night person",
    "night-person",
    "night owl",
    "night-owl",
    "nightowl",
    "nightlife",
    "night life",
    "late night",
    "late-night",
    "latenight",
    "evening person",
    "nocturnal",
    "insomniac",
    "after dark",
    "after midnight",
    "past midnight",
    "bar hop",
    "bar-hop",
    "clubbing",
    "nightclub",
    "night club",
    "evening owl",
    "sleep late",
    "sleeps late",
    "夜生活",
    "夜猫子",
    "深夜",
    "夜店",
    "酒吧夜景",
    "通宵",
  ];

  if (phraseHits.some((p) => blob.includes(p))) return true;

  // Word "night" as its own token (not knight, overnight as single word ok)
  if (/\bnight\b/.test(blob)) return true;

  return false;
}
