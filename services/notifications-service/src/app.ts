import crypto from "node:crypto";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import { env } from "./config/env";
import { logger, stream } from "./lib/logger";
import v1Routes from "./api/routes/v1";
import healthRoutes from "./api/routes/health.routes";
import { requireInternalApiKey } from "./middleware/internal-auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "512kb" }));
  app.use(morgan("combined", { stream }));

  app.use((req, res, next) => {
    const incoming = req.headers["x-request-id"];
    req.requestId =
      typeof incoming === "string" && incoming.length > 0
        ? incoming
        : crypto.randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });

  app.use("/health", healthRoutes);
  app.use("/v1", requireInternalApiKey, v1Routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
