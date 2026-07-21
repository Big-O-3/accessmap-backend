require("dotenv").config();
const fs = require("node:fs");
const https = require("node:https");
const app = require("./app");

const PORT = process.env.PORT || 3000;

// If SSL_CERT + SSL_KEY point at readable pem files, serve HTTPS. This is
// required in dev when the frontend runs on https:// and sends Secure cookies
// (browsers won't send a Secure cookie to an http:// origin). Falls back to
// plain HTTP when the envs are unset so teammates aren't forced to have certs.
const CERT = process.env.SSL_CERT;
const KEY = process.env.SSL_KEY;
const useHttps = CERT && KEY && fs.existsSync(CERT) && fs.existsSync(KEY);

if (useHttps) {
  https
    .createServer(
      { cert: fs.readFileSync(CERT), key: fs.readFileSync(KEY) },
      app,
    )
    .listen(PORT, () => {
      console.log(`AccessMap backend listening on https://localhost:${PORT}`);
    });
} else {
  app.listen(PORT, () => {
    console.log(`AccessMap backend listening on http://localhost:${PORT}`);
  });
}
