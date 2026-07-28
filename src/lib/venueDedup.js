// Find an existing venue that a new submission would duplicate, so we attach to
// it instead of creating a second card for the same place.
//
// Match order:
//   1. placeId — the map provider's stable id. If two submissions carry the same
//      placeId they are unambiguously the same place, regardless of spelling.
//   2. name + city (case-insensitive) — the fallback when there's no placeId
//      (e.g. a hand-typed venue). Not perfect, but it stops the common case of
//      re-adding a venue someone already entered.
//
// `client` is a PrismaClient or a transaction client, so callers inside a
// $transaction get the same isolation. Returns the matched venue or null.
async function findExistingVenue(client, { placeId, name, city }) {
  if (placeId) {
    const byPlace = await client.venue.findUnique({ where: { placeId } });
    if (byPlace) return byPlace;
  }

  if (name && city) {
    return client.venue.findFirst({
      where: {
        name: { equals: name.trim(), mode: "insensitive" },
        city: { equals: city.trim(), mode: "insensitive" },
      },
    });
  }

  return null;
}

module.exports = { findExistingVenue };
