// Express middleware that protects a route by requiring a valid Supabase JWT.
//
// Usage: router.post("/", requireAuth, handler)
// Reads the token from `Authorization: Bearer <token>`, verifies it with
// SUPABASE_JWT_SECRET (HS256), and upserts a local User row keyed by Supabase's
// `sub` (a uuid) so DB foreign keys like Review.userId still work.
// Sets req.userId on success; otherwise responds 401 and the handler never runs.

const { jwtVerify } = require("jose");
const prisma = require("../lib/prisma");

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "SUPABASE_JWT_SECRET is not set. Copy it from Supabase → Settings → API → JWT Settings.",
  );
}
const SECRET_KEY = new TextEncoder().encode(JWT_SECRET);

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
    const { payload } = await jwtVerify(token, SECRET_KEY, {
      algorithms: ["HS256"],
      // Supabase issues tokens with issuer "https://<ref>.supabase.co/auth/v1"
      // and audience "authenticated"; verifying audience keeps stray tokens out.
      audience: "authenticated",
    });
    await ensureUser(payload);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = requireAuth;
