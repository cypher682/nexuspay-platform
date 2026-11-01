import { Router } from "express";
import reportsRoutes from "./reports.routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    service: "reporting-service",
    version: "1.0.0",
    endpoints: ["/reports/payments/daily", "/reports/payments/daily.csv", "/reports/runs", "/reports/refresh"]
  });
});

router.use("/reports", reportsRoutes);

export default router;
