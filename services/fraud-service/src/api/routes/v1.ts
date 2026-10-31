import { Router } from "express";
import fraudRoutes from "./fraud.routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    service: "fraud-service",
    version: "1.0.0",
    endpoints: ["/fraud"]
  });
});

router.use("/fraud", fraudRoutes);

export default router;
