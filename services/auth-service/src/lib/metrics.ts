import type { NextFunction, Request, Response } from "express";
import client from "prom-client";

const registry = new client.Registry();
registry.setDefaultLabels({ service: "auth-service" });
client.collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total inbound HTTP requests",
  labelNames: ["method", "route", "status_class"],
  registers: [registry]
});

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Inbound HTTP request latency in seconds",
  labelNames: ["method", "route", "status_class"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry]
});

function routeLabel(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath === "string") return `${req.baseUrl}${routePath}`;
  return (req.statusCode ?? 500) >= 400 ? "unmatched" : (req.path || "/");
}

export function httpMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.path === "/metrics") return next();
    const start = httpRequestDuration.startTimer();
    res.once("finish", () => {
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      httpRequestsTotal.inc({ method: req.method, route: routeLabel(req), status_class: statusClass });
      httpRequestDuration.observe({ method: req.method, route: routeLabel(req), status_class: statusClass }, start());
    });
    return next();
  };
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader("Content-Type", registry.contentType);
  res.end(await registry.metrics());
}
