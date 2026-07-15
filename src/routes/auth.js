const express = require("express");
const prisma = require("../lib/prisma");
const { hashPassword, verifyPassword, signToken } = require("../lib/auth");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// Shape a user for API responses — never leak the password hash.
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/register
// Create an account and return a token so the user is logged in immediately.
router.post("/register", async (req, res, next) => {
  try {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
      return res
        .status(422)
        .json({ error: "email, password, and username are required" });
    }
    if (password.length < 8) {
      return res.status(422).json({ error: "password must be at least 8 characters" });
    }

    // Reject duplicates on the two unique fields with a clear 409.
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
    });
    if (existing) {
      return res.status(409).json({ error: "email or username already in use" });
    }

    const user = await prisma.user.create({
      data: { email, username, passwordHash: await hashPassword(password) },
    });

    res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login
// Exchange email + password for a token.
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(422).json({ error: "email and password are required" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Use the same message whether the email or the password is wrong, so we
    // don't reveal which emails are registered.
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me
// Return the currently authenticated user (proves the token works).
router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
