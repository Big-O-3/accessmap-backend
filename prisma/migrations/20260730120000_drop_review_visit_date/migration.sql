-- Drop the optional Review.visitDate column.
-- Reviews are now dated solely by their createdAt (the day the review was
-- posted), so a separately-entered visit date is no longer collected or shown.
-- This is destructive only for that column's data, which the UI no longer uses.
ALTER TABLE "Review" DROP COLUMN "visitDate";
