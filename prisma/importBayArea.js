// One-off importer to populate ~100 REAL Bay Area venues in three categories:
// restaurants, concert venues / arenas, and museums. Data comes from the
// Overpass API (OpenStreetMap). Accessibility features are mapped from OSM tags
// (mlDetected:false / verifiedCount:0 — honest defaults, not invented).
//
// Run with: npm run import:bay
//
// Behavior:
//   - Preserves venues that already have real contributions (photos, reviews,
//     or community-verified features) — those are never deleted.
//   - Deletes plain OSM-imported venues with no contributions.
//   - Imports fresh venues across the Bay Area, then trims to TARGET_TOTAL.
const prisma = require("../src/lib/prisma");

const STATE = "CA";
const TARGET_TOTAL = 100;

// Bay Area bounding box (roughly: South Bay up to North Bay, coast to East Bay).
// (south, west, north, east)
const BBOX = { south: 37.20, west: -122.55, north: 38.10, east: -121.70 };

// OSM tag combos for the three categories the product cares about. Each maps to
// one of our venueType values.
const VENUE_QUERIES = [
  { osm: '["amenity"="restaurant"]', venueType: "restaurant" },
  // Concert venues / arenas / theatres / stadiums.
  { osm: '["amenity"="theatre"]', venueType: "concert_venue" },
  { osm: '["amenity"="arts_centre"]', venueType: "concert_venue" },
  { osm: '["leisure"="stadium"]', venueType: "arena" },
  { osm: '["building"="stadium"]', venueType: "arena" },
  { osm: '["tourism"="museum"]', venueType: "museum" },
];

// How many of each category to keep in the final mix (fill order). Restaurants
// are plentiful; arenas/concert venues and museums are rarer, so cap restaurants
// and take as many of the others as exist.
const CATEGORY_TARGETS = { arena: 15, concert_venue: 25, museum: 25, restaurant: 60 };

function mapFeatures(tags) {
  const features = [];
  const push = (featureType) =>
    features.push({
      featureType,
      mlDetected: false,
      mlConfidence: null,
      communityVerified: false,
      verifiedCount: 0,
    });

  if (tags.wheelchair === "yes") push("entrance_detected");
  if (tags["toilets:wheelchair"] === "yes" || tags["wheelchair:toilets"] === "yes")
    push("restroom_available");
  if (tags["indoor_seating"] === "yes") push("indoor_seating");
  if (tags["outdoor_seating"] === "yes") push("seating_available");
  if (tags.parking === "yes" || tags["parking:disabled"] === "yes")
    push("parking_area");
  if (tags.wheelchair === "no" || tags.entrance === "steps")
    push("stairs_present");

  return features;
}

function buildQuery() {
  const bbox = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  const clauses = VENUE_QUERIES.map(
    ({ osm }) => `  nwr${osm}["name"](${bbox});`,
  ).join("\n");
  return `
[out:json][timeout:90];
(
${clauses}
);
out center tags;
`;
}

function classify(tags) {
  for (const { osm, venueType } of VENUE_QUERIES) {
    const m = osm.match(/\["([^"]+)"(?:="([^"]+)")?\]/);
    if (!m) continue;
    const [, key, val] = m;
    if (val ? tags[key] === val : tags[key] != null) return venueType;
  }
  return "other";
}

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function fetchOverpass(query) {
  const body = new URLSearchParams({ data: query }).toString();
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "AccessMap/1.0 (CodePath capstone; venue import)",
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        if (res.ok) return res.json();
        lastErr = new Error(`${url} returned ${res.status}`);
        console.log(`  ${url} -> ${res.status}, trying next mirror...`);
      } catch (e) {
        lastErr = e;
        console.log(`  ${url} failed (${e.message}), trying next mirror...`);
      }
    }
  }
  throw lastErr || new Error("All Overpass mirrors failed");
}

async function main() {
  // 1. Identify venues to PRESERVE: any with real contributions.
  const keepers = await prisma.venue.findMany({
    where: {
      OR: [
        { totalPhotos: { gt: 0 } },
        { totalReviews: { gt: 0 } },
        { features: { some: { communityVerified: true } } },
      ],
    },
    select: { id: true, name: true },
  });
  const keeperIds = new Set(keepers.map((k) => k.id));
  console.log(`Preserving ${keepers.length} venues with real contributions.`);

  // 2. Delete the rest (plain OSM imports, no activity).
  const del = await prisma.venue.deleteMany({
    where: { id: { notIn: [...keeperIds] } },
  });
  console.log(`Deleted ${del.count} contribution-free venues.`);

  // 3. Fetch fresh Bay Area venues.
  console.log("Querying Overpass for Bay Area venues...");
  const data = await fetchOverpass(buildQuery());
  const elements = data.elements || [];
  console.log(`Overpass returned ${elements.length} elements.`);

  // Group candidates by category, only those with a name + coordinates.
  const byCategory = { arena: [], concert_venue: [], museum: [], restaurant: [] };
  for (const el of elements) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lng ?? el.center?.lon;
    if (!tags.name || lat == null || lng == null) continue;
    const type = classify(tags);
    if (!byCategory[type]) continue;
    byCategory[type].push({ el, tags, lat, lng, type });
  }
  for (const c of Object.keys(byCategory)) {
    console.log(`  ${c}: ${byCategory[c].length} candidates`);
  }

  // 4. Fill up to TARGET_TOTAL, honoring per-category targets. Prefer candidates
  //    that actually have accessibility tags (more useful venues) first.
  const slotsLeft = () => TARGET_TOTAL - keeperIds.size;
  const chosen = [];
  const withData = (c) => c.filter((x) => mapFeatures(x.tags).length > 0);
  const withoutData = (c) => c.filter((x) => mapFeatures(x.tags).length === 0);

  for (const [type, target] of Object.entries(CATEGORY_TARGETS)) {
    if (chosen.length >= slotsLeft()) break;
    // Accessibility-tagged first, then the rest, capped at the category target.
    const pool = [...withData(byCategory[type]), ...withoutData(byCategory[type])];
    const take = Math.min(target, pool.length, slotsLeft() - chosen.length);
    chosen.push(...pool.slice(0, take));
  }

  console.log(`Importing ${chosen.length} new venues (target total ${TARGET_TOTAL})...`);

  let imported = 0;
  for (const { el, tags, lat, lng, type } of chosen) {
    const placeId = `osm:${el.type}/${el.id}`;
    const address = [tags["addr:housenumber"], tags["addr:street"]]
      .filter(Boolean)
      .join(" ");
    const venueData = {
      name: tags.name,
      address: address || `${tags["addr:city"] || "Bay Area"}, ${STATE}`,
      city: tags["addr:city"] || "Bay Area",
      state: STATE,
      zipCode: tags["addr:postcode"] || "",
      latitude: lat,
      longitude: lng,
      venueType: type,
    };
    await prisma.venue.upsert({
      where: { placeId },
      create: { ...venueData, placeId, features: { create: mapFeatures(tags) } },
      update: { ...venueData, features: { deleteMany: {}, create: mapFeatures(tags) } },
    });
    imported++;
    if (imported % 20 === 0) console.log(`  ...${imported} imported`);
  }

  const total = await prisma.venue.count();
  console.log(`Done. Imported ${imported} new. Total venues now: ${total}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
