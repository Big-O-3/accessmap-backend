-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleId" TEXT,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "placeId" TEXT,
    "venueType" TEXT NOT NULL,
    "accessibilityScore" INTEGER NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "totalPhotos" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueFeature" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "featureType" TEXT NOT NULL,
    "mlDetected" BOOLEAN NOT NULL DEFAULT false,
    "mlConfidence" DOUBLE PRECISION,
    "communityVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3),
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "userId" TEXT,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "mlAnalyzed" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MLAnalysis" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "processingTime" DOUBLE PRECISION,
    "totalDetections" INTEGER NOT NULL DEFAULT 0,
    "highConfidence" INTEGER NOT NULL DEFAULT 0,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MLAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Detection" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "mlAnalysisId" TEXT NOT NULL,
    "cocoLabel" TEXT NOT NULL,
    "accessibilityFeature" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "boundingBox" JSONB NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verificationCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_placeId_key" ON "Venue"("placeId");

-- CreateIndex
CREATE INDEX "Venue_latitude_longitude_idx" ON "Venue"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Venue_city_state_idx" ON "Venue"("city", "state");

-- CreateIndex
CREATE INDEX "VenueFeature_featureType_idx" ON "VenueFeature"("featureType");

-- CreateIndex
CREATE UNIQUE INDEX "VenueFeature_venueId_featureType_key" ON "VenueFeature"("venueId", "featureType");

-- CreateIndex
CREATE INDEX "Review_venueId_idx" ON "Review"("venueId");

-- CreateIndex
CREATE INDEX "Photo_venueId_idx" ON "Photo"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "MLAnalysis_photoId_key" ON "MLAnalysis"("photoId");

-- CreateIndex
CREATE INDEX "Detection_photoId_idx" ON "Detection"("photoId");

-- CreateIndex
CREATE INDEX "Detection_accessibilityFeature_idx" ON "Detection"("accessibilityFeature");

-- AddForeignKey
ALTER TABLE "VenueFeature" ADD CONSTRAINT "VenueFeature_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MLAnalysis" ADD CONSTRAINT "MLAnalysis_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detection" ADD CONSTRAINT "Detection_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Detection" ADD CONSTRAINT "Detection_mlAnalysisId_fkey" FOREIGN KEY ("mlAnalysisId") REFERENCES "MLAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
