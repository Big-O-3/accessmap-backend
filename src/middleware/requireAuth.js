// Express middleware that protects a route by requiring a valid Supabase JWT.
//
// Usage: router.post("/", requireAuth, handler)
// Reads the token from `Authorization: Bearer <token>`, verifies its signature,
// and upserts a local User row keyed by Supabase's `sub` (a uuid) so DB foreign
// keys like Review.userId still work.
// Sets req.userId on success; otherwise responds 401 and the handler never runs.
//
// Supabase signs access tokens one of two ways, and which one is live is a
// project setting rather than something this code picks:
//
//   ES256 / RS256  the current default. Tokens carry a `kid` and are verified
//                  against the project's public JWKS. Supabase rotates those
//                  keys on its own schedule, so we fetch them instead of
//                  pinning one.
//   HS256          the legacy shared secret (Settings → API → JWT Settings).
//
// Accepting only HS256 against a project that signs with ES256 rejects every
// token ever issued. That surfaces to the user as "your session expired" and
// never recovers no matter how many times they sign in again, so we verify
// whichever scheme the token itself declares.

const { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } = require("jose");
const prisma = require("../lib/prisma");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_URL && !JWT_SECRET) {
  throw new Error(
    "Set SUPABASE_URL (preferred — the same value the frontend uses for " +
      "VITE_SUPABASE_URL) so tokens can be verified against your project's " +
      "JWKS, or SUPABASE_JWT_SECRET if your project still signs with the " +
      "legacy HS256 shared secret.",
  );
}

// Caches the fetched keys and only re-fetches when a token shows up with an
// unrecognized `kid`, so this costs one request per key rotation rather than
// one per request.
const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(
      new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
    )
  : null;
const SECRET_KEY = JWT_SECRET ? new TextEncoder().encode(JWT_SECRET) : null;

async function verifyToken(token) {
  // Read the header to pick a key type. This is unverified input, so it only
  // decides WHICH verification runs — jwtVerify still rejects a token whose
  // signature doesn't match, and pinning `algorithms` below stops a token from
  // talking us into a weaker check than the one its key type requires.
  const { alg } = decodeProtectedHeader(token);

  const options = { audience: "authenticated" };
  // Supabase issues tokens with issuer "https://<ref>.supabase.co/auth/v1";
  // checking it keeps a valid token from some other project out.
  if (SUPABASE_URL) options.issuer = `${SUPABASE_URL}/auth/v1`;

  if (alg === "HS256") {
    if (!SECRET_KEY) {
      throw new Error(
        "token is signed HS256 but SUPABASE_JWT_SECRET is not set",
      );
    }
    return jwtVerify(token, SECRET_KEY, { ...options, algorithms: ["HS256"] });
  }

  if (!JWKS) {
    throw new Error(
      `token is signed ${alg}, which needs SUPABASE_URL set to reach the JWKS`,
    );
  }
  return jwtVerify(token, JWKS, {
    ...options,
    algorithms: ["ES256", "RS256"],
  });
}

function extractBearer(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  return null;
}

async function ensureUser(payload) {
  // Prefer Google-provided display metadata; fall back to the email local-part
  // so the username is never empty (schema requires it and it's unique).
  const meta = payload.user_metadata ?? {};
  const email = payload.email ?? null;
  const rawName =
    meta.full_name || meta.name || (email ? email.split("@")[0] : payload.sub);
  const username = rawName.slice(0, 60);

  const existing = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (existing) return existing;

  // First sign-in: create the row. If username collides (unique), append a short
  // suffix from the uuid so we never hit a constraint error on a new user.
  const suffix = payload.sub.slice(0, 6);
  return prisma.user.create({
    data: {
      id: payload.sub,
      email: email ?? `${payload.sub}@no-email.local`,
      username: `${username}-${suffix}`,
    },
  });
}

async function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const { payload } = await verifyToken(token);
    await ensureUser(payload);
    req.userId = payload.sub;
    next();
  } catch (err) {
    // Log the reason. Swallowed, the only symptom is a 401 that the frontend
    // renders as "your session expired" — which sends you off to look at token
    // lifetimes when the actual cause is usually a verification mismatch we
    // could have named outright.
    console.warn(`Rejected token (${err.code || "error"}): ${err.message}`);
    // Say which 401 this is: a genuinely expired token means "sign in again"
    // and anything else does not, so don't advertise the former for the latter.
    const expired = err.code === "ERR_JWT_EXPIRED";
    return res.status(401).json({
      error: expired ? "Session expired" : "Invalid token",
    });
  }
}

module.exports = requireAuth;
