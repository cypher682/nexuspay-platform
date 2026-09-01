import { prisma } from "../lib/prisma";
import { generateTotpSecret, generateTotpUri, verifyTotp } from "../lib/crypto";
import { decodeToken, isMfaChallengePayload } from "../lib/tokens";
import { HttpError } from "../middleware/error-handler";
import { recordAuditEvent } from "./audit.service";
import { revokeAllSessionsForUser } from "./auth.service";
import type { RequestOriginContext } from "./auth.service";

export async function setupMfa(userId: string): Promise<{ secret: string; otpauthUri: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "User not found");
  if (user.mfaEnabled) throw new HttpError(409, "MFA is already enabled");

  const existing = await prisma.mfaConfig.findUnique({ where: { userId } });
  const secret = existing?.isEnabled ? existing.secret : generateTotpSecret();

  if (existing) {
    await prisma.mfaConfig.update({
      where: { userId },
      data: { secret, isEnabled: false }
    });
  } else {
    await prisma.mfaConfig.create({ data: { userId, secret } });
  }

  return { secret, otpauthUri: generateTotpUri(secret, user.email) };
}

export async function confirmMfa(
  userId: string,
  code: string,
  origin: RequestOriginContext
): Promise<{ enabled: true }> {
  const config = await prisma.mfaConfig.findUnique({ where: { userId } });
  if (!config) throw new HttpError(400, "Run MFA setup first");

  if (!verifyTotp(config.secret, code)) {
    await recordAuditEvent({
      eventType: "mfa.setup.failure",
      status: "failure",
      userId,
      ipAddress: origin.ipAddress,
      userAgent: origin.userAgent
    });
    throw new HttpError(400, "Invalid MFA code");
  }

  await prisma.$transaction([
    prisma.mfaConfig.update({ where: { userId }, data: { isEnabled: true } }),
    prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } })
  ]);

  await recordAuditEvent({
    eventType: "mfa.setup.success",
    userId,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent
  });

  return { enabled: true };
}

export async function disableMfa(
  userId: string,
  password: string,
  origin: RequestOriginContext & { verifyPasswordFn?: (plain: string, hash: string) => Promise<boolean> }
): Promise<{ disabled: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError(404, "User not found");

  const verifyPasswordFn =
    origin.verifyPasswordFn ??
    (await import("../lib/crypto")).verifyPassword;
  if (!(await verifyPasswordFn(password, user.passwordHash))) {
    throw new HttpError(401, "Invalid password");
  }

  await prisma.mfaConfig.deleteMany({ where: { userId } });
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false } });

  await recordAuditEvent({
    eventType: "mfa.disabled",
    userId,
    ipAddress: origin.ipAddress,
    userAgent: origin.userAgent
  });

  return { disabled: true };
}

export function resolveChallengeUserId(challengeToken: string): string {
  let payload;
  try {
    payload = decodeToken(challengeToken);
  } catch {
    throw new HttpError(401, "Invalid or expired MFA challenge token");
  }
  if (!isMfaChallengePayload(payload)) {
    throw new HttpError(401, "Invalid token type for MFA challenge");
  }
  return payload.sub;
}

export async function assertSessionsRevokedCount(userId: string): Promise<number> {
  return revokeAllSessionsForUser(userId);
}
