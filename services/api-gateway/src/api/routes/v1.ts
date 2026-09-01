import { Router } from "express";
import { env } from "../../config/env";
import { proxy } from "../../lib/proxy";
import { authenticate } from "../../middleware/authenticate";
import { slidingWindowRateLimiter } from "../../middleware/rate-limiter";
import { callDownstream } from "../../lib/downstream";

const router = Router();

const generalLimiter = slidingWindowRateLimiter();
const authLimiter = slidingWindowRateLimiter({
  maxRequests: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
  bucketSuffix: "auth"
});

router.use((req, res, next) => {
  if (
    req.path.startsWith("/auth/login") ||
    req.path.startsWith("/auth/register") ||
    req.path.startsWith("/auth/refresh")
  ) {
    void authLimiter(req, res, next);
    return;
  }
  void generalLimiter(req, res, next);
});

router.get(
  "/me/summary",
  authenticate,
  async (req, res, next) => {
    try {
      const headers: Record<string, string> = {
        Authorization: req.headers.authorization ?? "",
        "X-Request-Id": req.requestId ?? ""
      };

      const [profileResult, paymentsResult] = await Promise.allSettled([
        callDownstream<{ id: string; email: string; fullName: string | null; mfaEnabled: boolean }>(
          "auth-service",
          `${env.AUTH_SERVICE_URL}/v1/users/me`,
          { headers }
        ),
        callDownstream<{ payments: unknown[]; nextCursor: string | null }>(
          "payments-service",
          `${env.PAYMENTS_SERVICE_URL}/v1/payments?limit=5`,
          { headers }
        )
      ]);

      const profile =
        profileResult.status === "fulfilled" ? profileResult.value : null;
      const payments =
        paymentsResult.status === "fulfilled" ? paymentsResult.value : null;

      res.json({
        requestId: req.requestId,
        profile:
          profile && profile.ok
            ? { source: "auth-service", data: profile.data }
            : { source: "auth-service", error: "unavailable" },
        recentPayments:
          payments && payments.ok
            ? { source: "payments-service", data: payments.data }
            : { source: "payments-service", error: "unavailable" }
      });
    } catch (err) {
      next(err);
    }
  }
);

const PUBLIC_AUTH_PATHS = new Set([
  "/register",
  "/login",
  "/refresh",
  "/mfa/verify",
  "/verify-email",
  "/forgot-password",
  "/reset-password"
]);

router.use("/auth", (req, res, next) => {
  if (!PUBLIC_AUTH_PATHS.has(req.path)) {
    authenticate(req, res, next);
    return;
  }
  next();
}, proxy(env.AUTH_SERVICE_URL));

router.use("/users", authenticate, proxy(env.AUTH_SERVICE_URL));

router.use("/payments", authenticate, proxy(env.PAYMENTS_SERVICE_URL));

router.use("/notifications", authenticate, (req, _res, next) => {
  req.headers["x-internal-api-key"] = env.INTERNAL_API_KEY;
  next();
}, proxy(env.NOTIFICATIONS_SERVICE_URL));

export default router;
