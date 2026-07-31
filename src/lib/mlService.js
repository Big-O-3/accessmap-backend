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

// Time budgets (ms). Without them, fetch() waits indefinitely - a wedged ML
// process would keep this request hanging forever instead of failing fast, and
// the user just watches a spinner. The ML call gets the longer budget: on a
// cold Render instance the model can take ~30s, and it may also be queued
// behind another photo (the service serializes inference), so allow generous
// headroom before giving up.
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS || 15000);
const ML_FETCH_TIMEOUT_MS = Number(process.env.ML_FETCH_TIMEOUT_MS || 120000);

// fetch() with a hard timeout. On expiry it aborts and throws; we translate
// that into a tagged, retryable error at the call sites below.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fetch an image by URL and send it to the ML service for detection.
// Returns the parsed response: { detections: [...], altTextSuggestion }.
async function analyzePhoto(imageUrl) {
  // 1. Download the image bytes.
  let imageResponse;
  try {
    imageResponse = await fetchWithTimeout(imageUrl, {}, IMAGE_FETCH_TIMEOUT_MS);
  } catch (err) {
    const timedOut = err.name === "AbortError";
    const wrapped = new Error(
      timedOut
        ? `Timed out fetching the image after ${IMAGE_FETCH_TIMEOUT_MS}ms`
        : `Failed to fetch image: ${err.message}`,
    );
    wrapped.status = 502;
    throw wrapped;
  }
  if (!imageResponse.ok) {
    // Tagged with a status so the route doesn't misreport a broken image URL as
    // "ML service unavailable" - the ML service isn't the thing that failed.
    const err = new Error(`Failed to fetch image (${imageResponse.status}): ${imageUrl}`);
    err.status = 502;
    throw err;
  }
  const imageBlob = await imageResponse.blob();

  // 2. Forward it to the ML service as multipart/form-data (field "image").
  const form = new FormData();
  form.append("image", imageBlob, "photo.jpg");

  let mlResponse;
  try {
    mlResponse = await fetchWithTimeout(
      `${ML_SERVICE_URL}/analyze`,
      { method: "POST", body: form },
      ML_FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    // Timeout or the ML host being unreachable. A timeout is retryable (the
    // model may just be busy/cold), so surface it as a 503 rather than a hard
    // fault; a connection error has no status and the route maps that to 503.
    const timedOut = err.name === "AbortError";
    const wrapped = new Error(
      timedOut
        ? "The analyzer took too long to respond. Please try again."
        : `Could not reach the ML service: ${err.message}`,
    );
    if (timedOut) wrapped.status = 503;
    throw wrapped;
  }
  if (!mlResponse.ok) {
    const detail = await mlResponse.json().catch(() => null);
    const err = new Error(detail?.error || `ML service error (${mlResponse.status})`);
    // Carry the status so callers can separate "still warming up, retry" (503)
    // from a genuine fault, and so a service that ANSWERED with an error isn't
    // reported as unreachable.
    err.status = mlResponse.status;
    throw err;
  }

  return mlResponse.json();
}

module.exports = {
  analyzePhoto,
  MODEL_VERSION,
  ML_SERVICE_URL,
  fetchWithTimeout,
  ML_FETCH_TIMEOUT_MS,
};
