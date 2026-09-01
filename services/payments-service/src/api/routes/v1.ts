import { Router } from "express";
import paymentsRoutes from "./payments.routes";
import webhooksRoutes from "./webhooks.routes";
import reconciliationRoutes from "./reconciliation.routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    service: "payments-service",
    version: "1.0.0",
    endpoints: ["/payments", "/webhooks", "/reconciliation"]
  });
});

router.use("/payments", paymentsRoutes);
router.use("/webhooks", webhooksRoutes);
router.use("/reconciliation", reconciliationRoutes);

export default router;
