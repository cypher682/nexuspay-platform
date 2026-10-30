import { Router } from "express";
import flagsRoutes from "./flags.routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    service: "feature-flags-service",
    version: "1.0.0",
    endpoints: ["/flags"]
  });
});

router.use("/flags", flagsRoutes);

export default router;
