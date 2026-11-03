import { Router } from "express";
import passport from "passport";
import { isGoogleAuthConfigured } from "./passport.js";
import { createLocalUser, toPublicUser, type User } from "./users.js";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export const authRouter = Router();

authRouter.get("/me", (req, res) => {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({ user: toPublicUser(req.user as User) });
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? "").trim().toLowerCase();
    const password = String(req.body?.password ?? "");
    const name = String(req.body?.name ?? "").trim();

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "A valid email address is required" });
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }

    const user = await createLocalUser({ email, password, name: name || undefined });
    req.login(user, (err) => {
      if (err) {
        next(err);
        return;
      }
      res.status(201).json({ user: toPublicUser(user) });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create account";
    if (message.includes("already exists")) {
      res.status(409).json({ error: message });
      return;
    }
    next(err);
  }
});

authRouter.post("/login", (req, res, next) => {
  passport.authenticate("local", (err: Error | null, user: User | false, info?: { message?: string }) => {
    if (err) {
      next(err);
      return;
    }
    if (!user) {
      res.status(401).json({ error: info?.message ?? "Invalid email or password" });
      return;
    }

    req.login(user, (loginErr) => {
      if (loginErr) {
        next(loginErr);
        return;
      }
      res.json({ user: toPublicUser(user) });
    });
  })(req, res, next);
});

authRouter.get("/google", (req, res, next) => {
  if (!isGoogleAuthConfigured()) {
    res.status(503).json({
      error: "Google OAuth is not configured",
      hint: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env",
    });
    return;
  }

  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })(req, res, next);
});

authRouter.get(
  "/google/callback",
  (req, res, next) => {
    if (!isGoogleAuthConfigured()) {
      res.redirect(`${FRONTEND_URL}/login?error=not_configured`);
      return;
    }

    passport.authenticate("google", {
      failureRedirect: `${FRONTEND_URL}/login?error=google_failed`,
    })(req, res, next);
  },
  (_req, res) => {
    res.redirect(FRONTEND_URL);
  },
);

authRouter.post("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) {
      next(err);
      return;
    }

    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        next(destroyErr);
        return;
      }

      res.clearCookie("connect.sid");
      res.status(204).send();
    });
  });
});
