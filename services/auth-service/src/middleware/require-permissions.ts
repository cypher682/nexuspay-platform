import type { NextFunction, Request, Response } from "express";
import { getPermissionNamesForUser } from "../services/rbac.service";
import { HttpError } from "./error-handler";

export function requirePermissions(...required: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      next(new HttpError(401, "Authentication required"));
      return;
    }

    try {
      const granted = await getPermissionNamesForUser(req.auth.userId);
      if (granted.has("*")) {
        req.auth.scopes = ["*"];
        next();
        return;
      }
      const missing = required.filter((p) => !granted.has(p));
      if (missing.length > 0) {
        next(new HttpError(403, `Missing required permissions: ${missing.join(", ")}`));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
