import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { env } from "../config/env";

const BCRYPT_MAX_PASSWORD_BYTES = 72;

export function hashPassword(plain: string): string {
  if (Buffer.byteLength(plain, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) {
    throw new Error("Password must not exceed 72 bytes");
  }
  return bcrypt.hashSync(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (Buffer.byteLength(plain, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) {
    return false;
  }
  // bcryptjs .compare runs in the libuv threadpool, keeping the Node event
  // loop free so concurrent login requests are not serialized behind CPU work.
  return bcrypt.compare(plain, hash);
}

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function generateTotpUri(secret: string, email: string): string {
  return authenticator.keyuri(email, env.MFA_ISSUER, secret);
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
