-- Make venue coordinates optional.
-- A contributor can add a venue (or add to an existing one) without pinning a
-- location; rows without coordinates are just omitted from the map and from
-- distance-based search. Dropping NOT NULL is non-destructive — existing rows
-- keep their values.
ALTER TABLE "Venue" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "Venue" ALTER COLUMN "longitude" DROP NOT NULL;
