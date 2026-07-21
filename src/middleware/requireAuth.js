// Express middleware that protects a route by requiring a valid JWT.
//
// Usage: router.post("/", requireAuth, handler)
// Reads the token from either the httpOnly "token" cookie (browsers) or an
// Authorization: Bearer header (CLI / test tools). Sets req.userId on success;
// otherwise responds 401 and the handler never runs.

const { verifyToken } = require("../lib/auth");

function extractToken(req) {
  // Cookie is checked first because that's how browsers authenticate.
  if (req.cookies && req.cookies.token) return req.cookies.token;
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    // Covers invalid signatures and expired tokens.
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = requireAuth;
