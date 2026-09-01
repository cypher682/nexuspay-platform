import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import path from "node:path";
import { env } from "./config/env";
import { stream } from "./lib/logger";
import v1Routes from "./api/routes/v1";
import healthRoutes from "./api/routes/health.routes";
import { correlationId } from "./middleware/correlation-id";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("combined", { stream }));

  app.use(correlationId);

  app.use("/health", healthRoutes);
  app.use("/docs", express.static(path.join(__dirname, "../public")));
  app.get("/docs/openapi.json", (_req, res) => {
    res.sendFile(path.join(__dirname, "../public/openapi.yaml"), { headers: { "Content-Type": "text/yaml" } });
  });

  app.use("/v1", v1Routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
