// Express middleware that reads the JWT if one is present, but never rejects.
//
// Usage: router.post("/", optionalAuth, handler)
// If a valid "Authorization: Bearer <token>" header is sent, req.userId is set
// to the authenticated user's id. Otherwise req.userId is null and the handler
// still runs. This lets contributions work before the frontend has a sign-in
// flow; once tokens are sent, the same routes attribute the work to the user
// with no further changes.

const { verifyToken } = require("../lib/auth");

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme === "Bearer" && token) {
    try {
      const payload = verifyToken(token);
      req.userId = payload.sub;
    } catch {
      // Ignore an invalid/expired token here — this route is public, so we
      // simply treat the request as anonymous rather than failing it.
      req.userId = null;
    }
  } else {
    req.userId = null;
  }

  next();
}

module.exports = optionalAuth;
