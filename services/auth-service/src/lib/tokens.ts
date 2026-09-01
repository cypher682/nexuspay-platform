import crypto from "node:crypto";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenClaims {
  sub: string;
  type: "access";
  scopes: string[];
  iss: string;
}

export interface RefreshTokenClaims {
  sub: string;
  type: "refresh";
  family_id: string;
  jti: string;
  iss: string;
}

export interface MfaChallengeClaims {
  sub: string;
  type: "mfa_challenge";
  jti: string;
  iss: string;
}

export type TokenPayload = AccessTokenClaims | RefreshTokenClaims | MfaChallengeClaims;

const issuer = env.MFA_ISSUER;

function seconds(days: number): number {
  return days * 24 * 60 * 60;
}

export function createAccessToken(subject: string, scopes: string[] = []): string {
  const payload = { sub: subject, type: "access", scopes, iss: issuer };
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: env.JWT_ALGORITHM,
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`
  });
}

export function createRefreshToken(subject: string, familyId: string): string {
  const payload = {
    sub: subject,
    type: "refresh",
    family_id: familyId,
    jti: crypto.randomUUID(),
    iss: issuer
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: env.JWT_ALGORITHM,
    expiresIn: `${seconds(env.REFRESH_TOKEN_TTL_DAYS)}s`
  } as SignOptions);
}

export function createMfaChallengeToken(subject: string): string {
  const payload = { sub: subject, type: "mfa_challenge", jti: crypto.randomUUID(), iss: issuer };
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: env.JWT_ALGORITHM,
    expiresIn: `${env.MFA_CHALLENGE_TTL_MINUTES}m`
  });
}

export function decodeToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    algorithms: [env.JWT_ALGORITHM],
    issuer
  }) as TokenPayload;
}

export function isRefreshPayload(payload: TokenPayload): payload is RefreshTokenClaims {
  return payload.type === "refresh";
}

export function isMfaChallengePayload(payload: TokenPayload): payload is MfaChallengeClaims {
  return payload.type === "mfa_challenge";
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
