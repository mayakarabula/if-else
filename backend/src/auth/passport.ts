import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import {
  findUserByEmail,
  findUserById,
  upsertGoogleUser,
  verifyLocalPassword,
  type User,
} from "./users.js";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      passwordHash?: string;
      googleId?: string;
      picture?: string;
      createdAt: string;
      updatedAt: string;
    }
  }
}

export function isGoogleAuthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function configurePassport() {
  passport.serializeUser((user, done) => {
    done(null, (user as User).id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await findUserById(id);
      done(null, user ?? undefined);
    } catch (err) {
      done(err);
    }
  });

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = await findUserByEmail(email);
          if (!user || !(await verifyLocalPassword(user, password))) {
            done(null, false, { message: "Invalid email or password" });
            return;
          }
          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );

  if (!isGoogleAuthConfigured()) {
    console.warn(
      "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google sign-in.",
    );
    return;
  }

  // Prefer the frontend origin (Vite proxy) so the session cookie is set for the UI host.
  const callbackURL =
    process.env.GOOGLE_CALLBACK_URL ??
    `${process.env.FRONTEND_URL ?? "http://localhost:5173"}/api/auth/google/callback`;

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL,
      },
      async (_accessToken, _refreshToken, profile: Profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            done(new Error("Google account did not provide an email address"));
            return;
          }

          const user = await upsertGoogleUser({
            googleId: profile.id,
            email,
            name: profile.displayName || email,
            picture: profile.photos?.[0]?.value,
          });

          done(null, user);
        } catch (err) {
          done(err as Error);
        }
      },
    ),
  );
}
