// Imports REAL popular venues from OpenStreetMap so well-known places (e.g.
// Salesforce Tower, Space Needle) already appear on the map without anyone
// adding them by hand. Run with: npm run import:osm
//
// Data comes from the Overpass API (OpenStreetMap's query service). We map
// OSM's accessibility tags to our own feature keys. Unlike seed.js, these are
// REAL places with REAL accessibility data — features are mlDetected:false and
// verifiedCount:0 because a human/AI hasn't verified them yet (honest defaults).
//
// Safe to re-run: venues are upserted by placeId ("osm:<type>/<id>"), so a
// second run updates existing rows instead of creating duplicates.
const prisma = require("../src/lib/prisma");

// Which city to import. Overpass matches an administrative area by name.
const CITY = process.env.OSM_CITY || "San Francisco";
const STATE = process.env.OSM_STATE || "CA";

// OSM tag combinations we treat as "venues" worth importing. Each entry becomes
// part of the Overpass query and maps to one of our venueType values.
const VENUE_QUERIES = [
  { osm: '["amenity"="library"]', venueType: "library" },
  { osm: '["tourism"="museum"]', venueType: "museum" },
  { osm: '["amenity"="cafe"]', venueType: "cafe" },
  { osm: '["amenity"="restaurant"]', venueType: "restaurant" },
  { osm: '["tourism"="attraction"]', venueType: "attraction" },
  { osm: '["office"]["name"]', venueType: "office" }, // towers, e.g. Salesforce Tower
];

// Translate OSM tags -> our feature keys (see frontend src/lib/features.js).
// Only emit a feature when OSM explicitly says yes, so we never invent data.
function mapFeatures(tags) {
  const features = [];
  const push = (featureType) =>
    features.push({
      featureType,
      mlDetected: false, // came from OSM tags, not our ML model
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
  // A stairs-only entrance is a barrier.
  if (tags.wheelchair === "no" || tags.entrance === "steps")
    push("stairs_present");

  return features;
}

// Build a single Overpass query that fetches all our venue categories inside
// the named city, returning each element's center coordinate.
function buildQuery() {
  const clauses = VENUE_QUERIES.map(
    ({ osm }) => `  nwr${osm}(area.searchArea);`,
  ).join("\n");
  return `
[out:json][timeout:60];
area["name"="${CITY}"]["admin_level"~"[68]"]->.searchArea;
(
${clauses}
);
out center tags;
`;
}

// Figure out which venueType a raw OSM element belongs to.
function classify(tags) {
  for (const { osm, venueType } of VENUE_QUERIES) {
    // osm looks like ["amenity"="cafe"] or ["office"]["name"]
    const m = osm.match(/\["([^"]+)"(?:="([^"]+)")?\]/);
    if (!m) continue;
    const [, key, val] = m;
    if (val ? tags[key] === val : tags[key] != null) return venueType;
  }
  return "other";
}

// Public Overpass instances get busy and return 504s. Try a few mirrors, with
// retries, before giving up.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function fetchOverpass(query) {
  const body = new URLSearchParams({ data: query }).toString();
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    // Overpass rejects requests without a descriptive User-Agent (HTTP 406).
    "User-Agent": "AccessMap/1.0 (CodePath capstone; venue import)",
  };

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        if (res.ok) return res.json();
        // 504/429 = busy; try the next mirror.
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
  const query = buildQuery();
  console.log(`Querying Overpass for venues in ${CITY}, ${STATE}...`);

  const data = await fetchOverpass(query);
  const elements = data.elements || [];
  console.log(`Overpass returned ${elements.length} elements.`);

  let imported = 0;
  let skipped = 0;

  for (const el of elements) {
    const tags = el.tags || {};
    const name = tags.name;
    // A named place with a resolvable coordinate is the minimum bar.
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || lat == null || lng == null) {
      skipped++;
      continue;
    }

    const placeId = `osm:${el.type}/${el.id}`;
    const address = [tags["addr:housenumber"], tags["addr:street"]]
      .filter(Boolean)
      .join(" ");

    const venueData = {
      name,
      address: address || `${CITY}, ${STATE}`,
      city: tags["addr:city"] || CITY,
      state: STATE,
      zipCode: tags["addr:postcode"] || "",
      latitude: lat,
      longitude: lng,
      venueType: classify(tags),
    };

    const features = mapFeatures(tags);

    // Upsert by placeId so re-runs don't duplicate. Replace features each run
    // so tag updates in OSM flow through.
    await prisma.venue.upsert({
      where: { placeId },
      create: {
        ...venueData,
        placeId,
        features: { create: features },
      },
      update: {
        ...venueData,
        features: { deleteMany: {}, create: features },
      },
    });

    imported++;
    if (imported % 25 === 0) console.log(`  ...${imported} imported`);
  }

  console.log(
    `Done. Imported/updated ${imported} venues (skipped ${skipped} unnamed/uncoordinated).`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
