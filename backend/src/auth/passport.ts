import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import {
  findUserByEmail,
  findUserById,
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
      picture?: string;
      createdAt: string;
      updatedAt: string;
    }
  }
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
}
