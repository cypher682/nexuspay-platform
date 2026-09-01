import { Router } from "express";
import notificationsRoutes from "./notifications.routes";
import templatesRoutes from "./templates.routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    service: "notifications-service",
    version: "1.0.0",
    endpoints: ["/notifications", "/templates"]
  });
});

router.use("/notifications", notificationsRoutes);
router.use("/templates", templatesRoutes);

export default router;
