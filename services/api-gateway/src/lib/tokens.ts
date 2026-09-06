import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessClaims {
  sub: string;
  type: "access" | "refresh" | "mfa_challenge";
  scopes: string[];
  family_id?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}

export function verifyAccessToken(token: string): AccessClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: env.AUTH_ISSUER
    }) as AccessClaims;
  } catch (err) {
    const oldKeys = env.OLD_JWT_SECRETS
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    for (const key of oldKeys) {
      try {
        return jwt.verify(token, key, { issuer: env.AUTH_ISSUER }) as AccessClaims;
      } catch {
        // try next key
      }
    }
    throw err;
  }
}
