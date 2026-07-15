// Express middleware that protects a route by requiring a valid JWT.
//
// Usage: router.post("/", requireAuth, handler)
// On success it sets req.userId to the authenticated user's id. On failure it
// responds 401 and the handler never runs.

const { verifyToken } = require("../lib/auth");

function requireAuth(req, res, next) {
  // Expect a header of the form: "Authorization: Bearer <token>".
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub; // the user id we stored when signing
    next();
  } catch {
    // Covers invalid signatures and expired tokens.
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = requireAuth;
