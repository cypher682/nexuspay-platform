import { Router } from "express";
import { prisma } from "../../lib/prisma";

const router = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok", service: "notifications-service", version: "1.0.0" });
});

router.get("/live", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/ready", async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "unavailable";
    healthy = false;
  }

  try {
    const { getChannel } = await import("../../lib/rabbitmq");
    await getChannel();
    checks.rabbitmq = "ok";
  } catch {
    checks.rabbitmq = "unavailable";
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({ status: healthy ? "ready" : "degraded", checks });
});

export default router;
