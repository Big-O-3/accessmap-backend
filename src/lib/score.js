// Accessibility score algorithm (0-100). Kept in sync with the frontend's
// src/lib/score.js so client and server agree on how scores are computed.
//
// A feature record looks like:
//   { featureType, mlDetected, mlConfidence, verifiedCount }

const WEIGHTS = {
  entrance_detected: 20,
  restroom_available: 20,
  parking_area: 15,
  seating_available: 10,
  indoor_seating: 10,
  stairs_present: -15, // barrier
};

const COMMUNITY_VERIFIED_THRESHOLD = 3;
const COMMUNITY_BONUS_MULTIPLIER = 1.2;

function calculateAccessibilityScore(features = []) {
  let score = 0;

  for (const feature of features) {
    const basePoints = WEIGHTS[feature.featureType] ?? 0;
    if (basePoints === 0) continue;

    // Community-added (non-ML) features are trusted at full weight.
    const confidence = feature.mlDetected ? (feature.mlConfidence ?? 0) : 1;
    const communityBonus =
      (feature.verifiedCount ?? 0) >= COMMUNITY_VERIFIED_THRESHOLD
        ? COMMUNITY_BONUS_MULTIPLIER
        : 1;

    score += basePoints * confidence * communityBonus;
  }

  return Math.round(Math.max(0, Math.min(score, 100)));
}

// Community accessibility verdict from review votes. Reviewers answer "Was this
// venue accessible? yes / partial / no"; this reduces the tallies to a single
// plain verdict. Returns null when there are no votes yet, so the UI can show
// "Not yet rated" rather than a misleading answer.
//
// Rule: a clear (>60%) majority of "yes" reads as accessible; a clear majority
// of "no" as not accessible; anything mixed (or mostly "partial") is "partial".
// We err toward caution because a wrong "accessible" is worse for a wheelchair
// user than a wrong "partial".
function communityVerdict({ yes = 0, partial = 0, no = 0 } = {}) {
  const total = yes + partial + no;
  if (total < 1) return null;

  if (yes / total > 0.6) return "yes";
  if (no / total > 0.6) return "no";
  return "partial";
}

module.exports = { calculateAccessibilityScore, communityVerdict };
