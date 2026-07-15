// Cloudinary client for storing uploaded venue photos.
//
// Configuration comes from environment variables (see .env.example). Get these
// three values from your Cloudinary dashboard (https://cloudinary.com) after
// creating a free account. If they're not set, uploads are disabled and the
// route falls back to accepting an image URL directly.

const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// True only when all three credentials are present.
const isConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
);

// Upload an in-memory image buffer to Cloudinary. Returns the full-size URL and
// a generated thumbnail URL. Cloudinary builds the thumbnail on the fly via URL
// transformation, so we don't store a second file.
function uploadImage(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "accessmap/venues", resource_type: "image" },
      (err, result) => {
        if (err) return reject(err);

        // A 300px-wide auto-cropped thumbnail derived from the same asset.
        const thumbnailUrl = cloudinary.url(result.public_id, {
          width: 300,
          height: 300,
          crop: "fill",
          fetch_format: "auto",
          quality: "auto",
        });

        resolve({ imageUrl: result.secure_url, thumbnailUrl });
      },
    );
    stream.end(buffer);
  });
}

module.exports = { uploadImage, isConfigured };
