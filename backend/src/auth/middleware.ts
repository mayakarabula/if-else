import type { NextFunction, Request, Response } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() && req.user) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

/** Browser-facing routes (Arena): redirect to the app login instead of JSON 401. */
export function requireAuthPage(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated?.() && req.user) {
    next();
    return;
  }

  const frontend = process.env.FRONTEND_URL ?? "http://localhost:5173";
  const returnTo = encodeURIComponent(req.originalUrl || "/arena");
  res.redirect(`${frontend}/login?next=${returnTo}`);
}
