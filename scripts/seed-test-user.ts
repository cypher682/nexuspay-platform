/**
 * Seed helper for k6 load tests.
 *
 * Registers a test user through the API and then marks it verified directly in
 * the database (the /v1/auth/verify-email endpoint is currently a 501 stub, so
 * there is no API path to complete verification yet).
 *
 * Requirements:
 *   - The stack must be running (API gateway on BASE_URL).
 *   - The auth-service image must have its Prisma client generated and the
 *     auth database reachable from where this script runs.
 *
 * Usage (from repo root):
 *   AUTH_DB_URL="postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_auth?schema=public" \
 *     tsx scripts/seed-test-user.ts
 *
 * Optional env:
 *   BASE_URL            default http://localhost:4000
 *   TEST_USER_EMAIL     default k6load@test.dev
 *   TEST_USER_PASSWORD  default K6LoadPass123!
 *   TEST_USER_FULLNAME  default K6 Load User
 */
import { PrismaClient } from "@prisma/client";

const apiBase = process.env.BASE_URL || "http://localhost:4000";
const email = process.env.TEST_USER_EMAIL || "k6load@test.dev";
const password = process.env.TEST_USER_PASSWORD || "K6LoadPass123!";
const fullName = process.env.TEST_USER_FULLNAME || "K6 Load User";

const dbUrl =
  process.env.AUTH_DB_URL ||
  "postgresql://nexuspay:nexuspay@localhost:5433/nexuspay_auth?schema=public";

async function registerViaApi(): Promise<boolean> {
  const res = await fetch(`${apiBase}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, fullName })
  });

  if (res.status === 201) {
    console.log(`[seed] registered ${email} via API`);
    return true;
  }
  if (res.status === 409) {
    console.log(`[seed] ${email} already exists (ok)`);
    return false;
  }
  console.warn(`[seed] register returned ${res.status}: ${await res.text()}`);
  return false;
}

async function markVerified(): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: dbUrl });
  try {
    const normalized = email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      console.error(`[seed] user ${normalized} not found in auth DB`);
      process.exit(1);
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true }
    });
    console.log(`[seed] marked ${normalized} (${user.id}) as verified`);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  await registerViaApi();
  await markVerified();
  console.log("[seed] done");
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
