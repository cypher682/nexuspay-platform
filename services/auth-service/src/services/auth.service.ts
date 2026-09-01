import crypto from "node:crypto";
import type { User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  createAccessToken,
  createMfaChallengeToken,
  createRefreshToken,
  decodeToken,
  hashToken,
  isMfaChallengePayload,
  isRefreshPayload
} from "../lib/tokens";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { HttpError } from "../middleware/error-handler";
import { recordAuditEvent } from "./audit.service";
import { assignRoleToUser, seedBaseRoles } from "./rbac.service";
import {
  checkLoginLockout,
  clearFailedLogins,
  recordFailedLogin
} from "./bruteforce.service";

export interface RequestOriginContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: PublicUser;
}

export interface MfaChallengeResult {
  mfaRequired: true;
  challengeToken: string;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string | null;
  status: string;
  isVerified: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    isVerified: user.isVerified,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt
  };
}

async function getUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

async function getEnabledMfa(userId: string) {
  return prisma.mfaConfig.findFirst({
    where: { userId, isEnabled: true }
  });
}

async function issueTokenPair(user: User): Promise<TokenPair> {
  const familyId = crypto.randomUUID();
  const refreshToken = createRefreshToken(user.id, familyId);

  await prisma.refreshTokenFamily.create({
    data: {
      userId: user.id,
      familyId,
      lastTokenHash: hashToken(refreshToken)
    }
  });

  return { accessToken: createAccessToken(user.id), refreshToken };
}

export async function registerUser(
  input: { email: string; password: string; fullName?: string },
  origin: RequestOriginContext
): Promise<AuthResult> {
  const normalizedEmail = input.email.toLowerCase();

  const existing = await getUserByEmail(normalizedEmail);
  if (existing) {
    throw new HttpError(409, "An account with this email already exists");
  }

  const verificationToken = crypto.randomBytes(32).toString("base64url");
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: hashPassword(input.password),
      fullName: input.fullName ?? null,
      verificationToken: hashToken(verificationToken)
    }
  });

  await assignRoleToUser(user.id, "user");
  await recordAuditEvent({
    eventType: "auth.register",
    userId: user.id,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent,
    metadata: { email: normalizedEmail }
  });

  const tokens = await issueTokenPair(user);
  return { user: toPublicUser(user), ...tokens };
}

export async function loginUser(
  input: { email: string; password: string },
  origin: RequestOriginContext
): Promise<AuthResult | MfaChallengeResult> {
  try {
    await checkLoginLockout(input.email, origin.ipAddress);
  } catch {
    await recordAuditEvent({
      eventType: "auth.login.locked",
      status: "locked",
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      metadata: { email: input.email.toLowerCase() }
    });
    throw new HttpError(423, "Too many failed login attempts. Try again later.");
  }

  const user = await getUserByEmail(input.email);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    await recordFailedLogin(input.email, origin.ipAddress);
    await recordAuditEvent({
      eventType: "auth.login.failure",
      status: "failure",
      userId: user?.id ?? null,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent,
      metadata: { email: input.email.toLowerCase() }
    });
    throw new HttpError(401, "Invalid email or password");
  }

  if (user.status !== "ACTIVE") {
    await recordAuditEvent({
      eventType: "auth.login.inactive",
      status: "failure",
      userId: user.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent
    });
    throw new HttpError(403, "User account is not active");
  }

  if (!user.isVerified) {
    await recordAuditEvent({
      eventType: "auth.login.unverified",
      status: "failure",
      userId: user.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent
    });
    throw new HttpError(403, "Email not verified. Check your inbox for the verification link.");
  }

  await clearFailedLogins(input.email, origin.ipAddress);

  if (user.mfaEnabled && (await getEnabledMfa(user.id))) {
    await recordAuditEvent({
      eventType: "mfa.challenge.issued",
      userId: user.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent
    });
    return { mfaRequired: true, challengeToken: createMfaChallengeToken(user.id) };
  }

  const tokens = await issueTokenPair(user);
  await recordAuditEvent({
    eventType: "auth.login.success",
    userId: user.id,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent
  });
  return { user: toPublicUser(user), ...tokens };
}

export async function verifyMfaChallenge(
  input: { challengeToken: string; code: string },
  origin: RequestOriginContext
): Promise<AuthResult> {
  let payload;
  try {
    payload = decodeToken(input.challengeToken);
  } catch {
    throw new HttpError(401, "Invalid or expired MFA challenge token");
  }

  if (!isMfaChallengePayload(payload)) {
    throw new HttpError(401, "Invalid token type for MFA challenge");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Invalid MFA challenge");
  }

  const mfaConfig = await getEnabledMfa(user.id);
  if (!mfaConfig) {
    throw new HttpError(400, "MFA is not enabled for this account");
  }

  const { verifyTotp } = await import("../lib/crypto");
  if (!verifyTotp(mfaConfig.secret, input.code)) {
    await recordAuditEvent({
      eventType: "mfa.challenge.failure",
      status: "failure",
      userId: user.id,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent
    });
    throw new HttpError(400, "Invalid MFA code");
  }

  const tokens = await issueTokenPair(user);
  await recordAuditEvent({
    eventType: "mfa.challenge.success",
    userId: user.id,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent
  });
  return { user: toPublicUser(user), ...tokens };
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  let payload;
  try {
    payload = decodeToken(refreshToken);
  } catch {
    throw new HttpError(401, "Invalid refresh token");
  }

  if (!isRefreshPayload(payload)) {
    throw new HttpError(401, "Invalid token type");
  }

  const family = await prisma.refreshTokenFamily.findUnique({
    where: { familyId: payload.family_id }
  });

  if (!family || family.isRevoked || family.userId !== payload.sub) {
    await recordAuditEvent({
      eventType: "auth.refresh.failure",
      status: "failure",
      userId: payload.sub,
      metadata: { familyId: payload.family_id, reason: "invalid_family" }
    });
    throw new HttpError(401, "Refresh token family is invalid");
  }

  const presentedHash = hashToken(refreshToken);
  if (family.lastTokenHash !== presentedHash) {
    await prisma.refreshTokenFamily.update({
      where: { id: family.id },
      data: { isRevoked: true, revokedAt: new Date() }
    });
    await recordAuditEvent({
      eventType: "auth.refresh.reuse_detected",
      status: "warning",
      userId: payload.sub,
      metadata: { familyId: family.familyId }
    });
    throw new HttpError(401, "Refresh token reuse detected");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "ACTIVE") {
    throw new HttpError(401, "Invalid refresh token");
  }

  const nextRefreshToken = createRefreshToken(user.id, family.familyId);
  await prisma.refreshTokenFamily.update({
    where: { id: family.id },
    data: { lastTokenHash: hashToken(nextRefreshToken) }
  });
  await recordAuditEvent({
    eventType: "auth.refresh.success",
    userId: user.id,
    metadata: { familyId: family.familyId }
  });

  return { accessToken: createAccessToken(user.id), refreshToken: nextRefreshToken };
}

export async function logoutUser(
  refreshToken: string | undefined,
  origin: RequestOriginContext & { userId?: string }
): Promise<void> {
  if (refreshToken) {
    try {
      const payload = decodeToken(refreshToken);
      if (isRefreshPayload(payload)) {
        await prisma.refreshTokenFamily.updateMany({
          where: { familyId: payload.family_id },
          data: { isRevoked: true, revokedAt: new Date() }
        });
      }
    } catch {
      /* logout is best-effort for malformed tokens */
    }
  }

  await recordAuditEvent({
    eventType: "auth.logout",
    userId: origin.userId ?? null,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const result = await prisma.refreshTokenFamily.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true, revokedAt: new Date() }
  });
  return result.count;
}

export async function bootstrapSeedData(): Promise<void> {
  await seedBaseRoles();
}
