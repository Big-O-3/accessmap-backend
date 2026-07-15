// Auth helpers: password hashing (bcrypt) and JSON Web Tokens (JWT).
//
// A JWT is a signed token we hand to the client on login. The client sends it
// back in the "Authorization: Bearer <token>" header on later requests, and we
// verify the signature to trust the user id inside — no server-side session
// store needed.

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Cost factor for bcrypt. 10 is a sensible default (higher = slower/safer).
const SALT_ROUNDS = 10;

// How long a login token stays valid.
const TOKEN_EXPIRY = "7d";

// The secret used to sign tokens. MUST be set in production; we fall back to a
// dev-only value so the app still runs locally without config.
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";

// Turn a plain password into a hash we can safely store.
function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

// Check a plain password against a stored hash. Returns true/false.
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Create a signed token carrying the user's id (the "sub" / subject claim).
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

// Verify a token and return its payload, or throw if invalid/expired.
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
