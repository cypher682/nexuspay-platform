import type { NextFunction, Request, Response } from "express";
import client from "prom-client";

const registry = new client.Registry();
registry.setDefaultLabels({ service: "payments-service" });
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

export const paymentsQueueDepth = new client.Gauge({
  name: "payments_queue_depth",
  help: "Number of payments currently waiting, active and delayed in the BullMQ queue",
  labelNames: ["state"],
  registers: [registry]
});

export function refreshQueueMetrics(queue: import("bullmq").Queue): () => void {
  const tick = () => {
    void queue
      .getJobCounts("waiting", "active", "delayed", "failed")
      .then((counts) => {
        paymentsQueueDepth.set({ state: "waiting" }, counts.waiting ?? 0);
        paymentsQueueDepth.set({ state: "active" }, counts.active ?? 0);
        paymentsQueueDepth.set({ state: "delayed" }, counts.delayed ?? 0);
        paymentsQueueDepth.set({ state: "failed" }, counts.failed ?? 0);
      })
      .catch(() => undefined);
  };
  tick();
  const h = setInterval(tick, 15_000);
  h.unref();
  return () => clearInterval(h);
}

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