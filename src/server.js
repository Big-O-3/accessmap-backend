require("dotenv").config();
const fs = require("node:fs");
const https = require("node:https");
const app = require("./app");

const PORT = process.env.PORT || 3000;

// Supabase serves its pooler on two ports that need different Prisma settings,
// and the hostname is identical either way, so the wrong combination is easy to
// deploy. Port 6543 is transaction mode: a connection is lent per transaction,
// so Prisma's named prepared statements can reach a backend that never saw the
// PREPARE and fail with Postgres 26000. `?pgbouncer=true` turns them off.
//
// Warn rather than exit: the misconfiguration is load-dependent, so a single
// developer never trips it and a running deployment shouldn't be killed over it.
// Left silent it surfaces as intermittent 500s under real traffic, which is a
// miserable thing to debug from the symptom backwards.
function checkDatabaseUrl(rawUrl) {
  if (!rawUrl) return;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return; // Malformed — let Prisma report it, with its better error message.
  }
  if (url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") {
    console.warn(
      "WARNING: DATABASE_URL points at the transaction pooler (port 6543) " +
        "without ?pgbouncer=true. Queries will fail intermittently under " +
        'concurrency with Postgres 26000 ("prepared statement does not exist"). ' +
        "Append ?pgbouncer=true&connection_limit=1, or switch to port 5432.",
    );
  }
}

checkDatabaseUrl(process.env.DATABASE_URL);

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
