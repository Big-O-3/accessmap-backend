// Seeds a few Seattle venues with accessibility features so the API returns
// real data in development. Run with: npm run seed
const prisma = require("../src/lib/prisma");

const VENUES = [
  {
    name: "Seattle Central Library",
    address: "1000 4th Ave",
    city: "Seattle",
    state: "WA",
    zipCode: "98104",
    latitude: 47.6067,
    longitude: -122.3325,
    venueType: "library",
    totalReviews: 12,
    totalPhotos: 8,
    features: [
      { featureType: "entrance_detected", mlDetected: true, mlConfidence: 0.94, verifiedCount: 5 },
      { featureType: "restroom_available", mlDetected: true, mlConfidence: 0.88, verifiedCount: 4 },
      { featureType: "parking_area", mlDetected: true, mlConfidence: 0.8, verifiedCount: 2 },
      { featureType: "seating_available", mlDetected: true, mlConfidence: 0.9, verifiedCount: 3 },
    ],
  },
  {
    name: "Pike Place Market",
    address: "85 Pike St",
    city: "Seattle",
    state: "WA",
    zipCode: "98101",
    latitude: 47.6097,
    longitude: -122.3417,
    venueType: "market",
    totalReviews: 34,
    totalPhotos: 21,
    features: [
      { featureType: "entrance_detected", mlDetected: true, mlConfidence: 0.7, verifiedCount: 6 },
      { featureType: "stairs_present", mlDetected: true, mlConfidence: 0.95, verifiedCount: 8 },
      { featureType: "restroom_available", mlDetected: true, mlConfidence: 0.6, verifiedCount: 2 },
    ],
  },
  {
    name: "Museum of Pop Culture",
    address: "325 5th Ave N",
    city: "Seattle",
    state: "WA",
    zipCode: "98109",
    latitude: 47.6215,
    longitude: -122.3481,
    venueType: "museum",
    totalReviews: 19,
    totalPhotos: 15,
    features: [
      { featureType: "entrance_detected", mlDetected: true, mlConfidence: 0.96, verifiedCount: 7 },
      { featureType: "restroom_available", mlDetected: true, mlConfidence: 0.92, verifiedCount: 5 },
      { featureType: "parking_area", mlDetected: true, mlConfidence: 0.85, verifiedCount: 4 },
      { featureType: "indoor_seating", mlDetected: true, mlConfidence: 0.88, verifiedCount: 3 },
    ],
  },
];

async function main() {
  for (const { features, ...venue } of VENUES) {
    await prisma.venue.create({
      data: {
        ...venue,
        features: { create: features },
      },
    });
    console.log(`Seeded: ${venue.name}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
