// Find an existing venue that a new submission would duplicate, so we attach to
// it instead of creating a second card for the same place. Shared by the
// venue-create path (POST /api/venues) and the inline-venue branch of
// POST /api/contributions.
//
// Match order (first hit wins):
//   1. placeId - the map provider's stable id. Same placeId is unambiguously
//      the same place regardless of spelling or coordinates.
//   2. name + coordinates - same (case-insensitive) name within COORD_EPSILON of
//      the given point. Tight enough that genuinely different branches of a
//      chain (e.g. two locations a mile apart) stay separate venues. Used when
//      the submission carries coordinates.
//   3. name + city - the fallback when there are no coordinates (a hand-typed
//      venue added without a location). Not perfect, but it stops the common
//      case of re-adding a venue someone already entered.
//
// `client` is a PrismaClient or a transaction client, so callers inside a
// $transaction get the same isolation. Returns the matched venue or null.

// Two venues count as the same place when they share a name AND sit within this
// many degrees of each other. ~0.0005° ≈ 55 meters.
const COORD_EPSILON = 0.0005;

async function findExistingVenue(client, { placeId, name, city, latitude, longitude }) {
  if (placeId) {
    const byPlace = await client.venue.findUnique({ where: { placeId } });
    if (byPlace) return byPlace;
  }

  if (!name) return null;
  const trimmedName = name.trim();

  const hasCoords = latitude != null && longitude != null;
  if (hasCoords) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    // Same name within the coordinate box. When coordinates are supplied they
    // are the disambiguator: a same-name place outside the box is treated as a
    // distinct branch (not merged), so we do NOT fall back to name+city here.
    return client.venue.findFirst({
      where: {
        name: { equals: trimmedName, mode: "insensitive" },
        latitude: { gte: lat - COORD_EPSILON, lte: lat + COORD_EPSILON },
        longitude: { gte: lng - COORD_EPSILON, lte: lng + COORD_EPSILON },
      },
    });
  }

  // No coordinates to disambiguate on - fall back to name + city so a venue
  // added without a location still dedupes against an earlier entry.
  if (city) {
    return client.venue.findFirst({
      where: {
        name: { equals: trimmedName, mode: "insensitive" },
        city: { equals: city.trim(), mode: "insensitive" },
      },
    });
  }

  return null;
}

module.exports = { findExistingVenue, COORD_EPSILON };
