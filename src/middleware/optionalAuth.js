// Express middleware that reads the JWT if one is present, but never rejects.
//
// Usage: router.post("/", optionalAuth, handler)
// Sets req.userId from either the httpOnly cookie or an Authorization: Bearer
// header if either carries a valid token; otherwise req.userId is null. Public
// routes use this so anonymous browsing keeps working while signed-in requests
// still get attribution.

const { verifyToken } = require("../lib/auth");

function extractToken(req) {
  if (req.cookies && req.cookies.token) return req.cookies.token;
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  return null;
}

function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) {
    req.userId = null;
    return next();
  }
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
  } catch {
    // Public route: treat an invalid/expired token as anonymous rather than
    // rejecting the request.
    req.userId = null;
  }
  next();
}

module.exports = optionalAuth;
