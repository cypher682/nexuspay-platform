import { redis } from "../lib/redis";
import { env } from "../config/env";
import { HttpError } from "../middleware/error-handler";

const KEY_PREFIX = "nexuspay:auth:login";

function counterKeys(email: string, ipAddress?: string | null): string[] {
  const keys = [`${KEY_PREFIX}:failed:account:${email.toLowerCase()}`];
  if (ipAddress) keys.push(`${KEY_PREFIX}:failed:ip:${ipAddress}`);
  return keys;
}

function lockoutKeys(email: string, ipAddress?: string | null): string[] {
  const keys = [`${KEY_PREFIX}:lockout:account:${email.toLowerCase()}`];
  if (ipAddress) keys.push(`${KEY_PREFIX}:lockout:ip:${ipAddress}`);
  return keys;
}

export async function checkLoginLockout(email: string, ipAddress?: string | null): Promise<void> {
  for (const key of lockoutKeys(email, ipAddress)) {
    if (await redis.exists(key)) {
      throw new HttpError(423, "Too many failed login attempts. Try again later.");
    }
  }
}

export async function recordFailedLogin(email: string, ipAddress?: string | null): Promise<void> {
  for (const counterKey of counterKeys(email, ipAddress)) {
    const attempts = await redis.incr(counterKey);
    if (attempts === 1) {
      await redis.expire(counterKey, env.LOGIN_LOCKOUT_TTL_SECONDS);
    }
    if (attempts >= env.MAX_FAILED_LOGIN_ATTEMPTS) {
      await redis.set(
        counterKey.replace(":failed:", ":lockout:"),
        "1",
        "EX",
        env.LOGIN_LOCKOUT_TTL_SECONDS
      );
    }
  }
}

export async function clearFailedLogins(email: string, ipAddress?: string | null): Promise<void> {
  const keys = [...counterKeys(email, ipAddress), ...lockoutKeys(email, ipAddress)];
  if (keys.length > 0) await redis.del(...keys);
}
