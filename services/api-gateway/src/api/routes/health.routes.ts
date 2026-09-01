import { Router } from "express";
import { redis } from "../../lib/redis";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "api-gateway", version: "1.0.0" });
});

router.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/ready", async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await redis.ping();
    checks.redis = "ok";
  } catch {
    checks.redis = "unavailable";
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({ status: healthy ? "ready" : "degraded", checks });
});

export default router;
