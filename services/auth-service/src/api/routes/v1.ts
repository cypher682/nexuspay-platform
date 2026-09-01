import { Router } from "express";
import authRoutes from "./auth.routes";
import usersRoutes from "./users.routes";
import mfaRoutes from "./mfa.routes";

const router = Router();

router.get("/", (_req, res) => {
  res.json({
    service: "auth-service",
    version: "1.0.0",
    endpoints: ["/auth", "/users", "/mfa"]
  });
});

router.use("/auth", authRoutes);
router.use("/users", usersRoutes);
router.use("/mfa", mfaRoutes);

export default router;
