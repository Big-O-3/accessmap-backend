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

module.exports = { calculateAccessibilityScore };
