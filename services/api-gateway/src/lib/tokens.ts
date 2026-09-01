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
  return jwt.verify(token, env.JWT_SECRET, {
    issuer: env.AUTH_ISSUER
  }) as AccessClaims;
}
