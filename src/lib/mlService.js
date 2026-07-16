// Client for the Python ML service (accessmap-ml), which runs Grounding DINO
// and returns detected accessibility features for a photo.
//
// The ML service exposes POST /analyze expecting a multipart image upload. Our
// photos are stored as URLs (e.g. Cloudinary), so we fetch the image bytes here
// and forward them to the ML service.

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";

// The model version we record on each MLAnalysis row. Keep in sync with the
// model used by accessmap-ml (detector.py MODEL_VERSION).
const MODEL_VERSION = "grounding-dino-tiny";

// Fetch an image by URL and send it to the ML service for detection.
// Returns the parsed response: { detections: [...], altTextSuggestion }.
async function analyzePhoto(imageUrl) {
  // 1. Download the image bytes.
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch image (${imageResponse.status}): ${imageUrl}`);
  }
  const imageBlob = await imageResponse.blob();

  // 2. Forward it to the ML service as multipart/form-data (field "image").
  const form = new FormData();
  form.append("image", imageBlob, "photo.jpg");

  const mlResponse = await fetch(`${ML_SERVICE_URL}/analyze`, {
    method: "POST",
    body: form,
  });
  if (!mlResponse.ok) {
    throw new Error(`ML service error (${mlResponse.status})`);
  }

  return mlResponse.json();
}

module.exports = { analyzePhoto, MODEL_VERSION, ML_SERVICE_URL };
