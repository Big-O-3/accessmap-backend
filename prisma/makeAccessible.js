// Marks 8 well-known venues as highly accessible so the demo has recognizable
// places with strong scores. Run with: node prisma/makeAccessible.js
//
// For each target venue we upsert a set of accessibility features (entrance,
// restroom, parking, seating) with verifiedCount above the community threshold
// so the 1.2x community bonus applies, then recompute accessibilityScore with
// the SAME algorithm the API uses (src/lib/score.js) so the stored number
// always matches the features. Idempotent: features are upserted by
// (venueId, featureType) and re-running just refreshes them.
const prisma = require("../src/lib/prisma");
const { calculateAccessibilityScore } = require("../src/lib/score");

// Recognizable OSM-imported venues (see prisma/importOsm.js). Matched by name
// so the script keeps working even if ids change between DB rebuilds.
const TARGET_NAMES = [
  "Salesforce Tower",
  "Exploratorium",
  "San Francisco Museum of Modern Art",
  "Asian Art Museum of San Francisco",
  "Palace of Fine Arts Theatre",
  "Museum of the African Diaspora",
  "Children’s Discovery Museum",
  "Walt Disney Family Museum",
];

// A strong-but-honest feature set: all the positive features, community-verified
// past the threshold (3) so the bonus kicks in. No stairs_present barrier.
const ACCESSIBLE_FEATURES = [
  { featureType: "entrance_detected", mlDetected: true, mlConfidence: 0.95, verifiedCount: 6 },
  { featureType: "restroom_available", mlDetected: true, mlConfidence: 0.9, verifiedCount: 5 },
  { featureType: "parking_area", mlDetected: true, mlConfidence: 0.85, verifiedCount: 4 },
  { featureType: "seating_available", mlDetected: true, mlConfidence: 0.9, verifiedCount: 4 },
];

async function main() {
  let updated = 0;
  const missing = [];

  for (const name of TARGET_NAMES) {
    const venue = await prisma.venue.findFirst({ where: { name } });
    if (!venue) {
      missing.push(name);
      continue;
    }

    // Upsert each feature so re-runs refresh rather than duplicate. The schema
    // has a unique constraint on (venueId, featureType).
    for (const f of ACCESSIBLE_FEATURES) {
      await prisma.venueFeature.upsert({
        where: { venueId_featureType: { venueId: venue.id, featureType: f.featureType } },
        create: {
          venueId: venue.id,
          featureType: f.featureType,
          mlDetected: f.mlDetected,
          mlConfidence: f.mlConfidence,
          communityVerified: true,
          verifiedCount: f.verifiedCount,
        },
        update: {
          mlDetected: f.mlDetected,
          mlConfidence: f.mlConfidence,
          communityVerified: true,
          verifiedCount: f.verifiedCount,
        },
      });
    }

    // Recompute the score from the venue's full current feature set so the
    // stored number matches the algorithm exactly.
    const features = await prisma.venueFeature.findMany({ where: { venueId: venue.id } });
    const accessibilityScore = calculateAccessibilityScore(features);

    await prisma.venue.update({
      where: { id: venue.id },
      data: { accessibilityScore },
    });

    console.log(`  ${name} -> score ${accessibilityScore}`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated}/${TARGET_NAMES.length} venues.`);
  if (missing.length) {
    console.log(`Not found (skipped): ${missing.join(", ")}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
