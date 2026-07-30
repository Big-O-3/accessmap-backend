-- Community accessibility verdict from review votes.
-- Each review can now answer "Was this venue accessible? yes / partial / no"
-- (separate from the star rating, which measures overall experience). The three
-- Venue counters are denormalized tallies of those votes so the community
-- verdict can be derived without loading every review; they default to 0 and
-- the review column is nullable, so this is additive and non-destructive —
-- existing venues start at 0 votes and older reviews carry no vote.
ALTER TABLE "Venue" ADD COLUMN     "accessNoCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "accessPartialCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "accessYesCount" INTEGER NOT NULL DEFAULT 0;

-- The reviewer's accessibility verdict for this visit: "yes" | "partial" | "no"
-- (nullable — older reviews predate this feature).
ALTER TABLE "Review" ADD COLUMN     "accessibilityVote" TEXT;
