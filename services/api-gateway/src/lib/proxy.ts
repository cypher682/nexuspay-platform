import http from "node:http";
import type { Request, Response, NextFunction } from "express";
import { URL } from "node:url";
import { logger } from "./logger";
import { env } from "../config/env";

const failureCounts = new Map<string, { count: number; openedAt: number }>();
const CIRCUIT_THRESHOLD = 5;
const CIRCUIT_RESET_MS = 30_000;

function isCircuitOpen(target: string): boolean {
  const state = failureCounts.get(target);
  if (!state) return false;
  if (state.count < CIRCUIT_THRESHOLD) return false;
  if (Date.now() - state.openedAt > CIRCUIT_RESET_MS) {
    failureCounts.delete(target);
    return false;
  }
  return true;
}

function recordFailure(target: string): void {
  const existing = failureCounts.get(target);
  if (existing) {
    existing.count += 1;
  } else {
    failureCounts.set(target, { count: 1, openedAt: Date.now() });
  }
}

function recordSuccess(target: string): void {
  failureCounts.delete(target);
}

export function proxy(target: string) {
  const parsed = new URL(target);

  return function proxyHandler(req: Request, res: Response, next: NextFunction) {
    if (isCircuitOpen(target)) {
      if (!res.headersSent) {
        res.status(503).json({ error: "service_unavailable", message: "Downstream temporarily unavailable", requestId: req.requestId ?? "" });
      }
      return;
    }

    const outgoingHeaders: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        outgoingHeaders[key] = value;
      }
    }

    const reqId = req.requestId ?? "";
    outgoingHeaders["x-request-id"] = reqId;

    if (req.auth) {
      outgoingHeaders["x-user-id"] = req.auth.userId;
      outgoingHeaders["x-user-scopes"] = req.auth.scopes.join(",");
    }

    let body: Buffer | undefined;
    if (req.body && Object.keys(req.body).length > 0) {
      const raw = JSON.stringify(req.body);
      body = Buffer.from(raw);
      outgoingHeaders["content-type"] = "application/json";
      outgoingHeaders["content-length"] = String(body.length);
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        if (chunks.length > 0) {
          body = Buffer.concat(chunks);
        }
        doProxy();
      });
      req.on("error", () => {
        if (!res.headersSent) {
          res.status(502).json({ error: "bad_gateway", message: "Failed to read request body", requestId: reqId });
        }
      });
      return;
    }

    doProxy();

    function doProxy() {
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port,
        path: req.originalUrl,
        method: req.method,
        headers: outgoingHeaders,
        timeout: env.DOWNSTREAM_TIMEOUT_MS,
      };

      const proxyReq = http.request(options, (proxyRes) => {
        recordSuccess(target);
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      });

      proxyReq.on("timeout", () => {
        proxyReq.destroy();
        recordFailure(target);
        logger.error("proxy.timeout", { target, path: req.originalUrl });
        if (!res.headersSent) {
          res.status(504).json({ error: "gateway_timeout", message: "Downstream timed out", requestId: reqId });
        }
      });

      proxyReq.on("error", (err) => {
        recordFailure(target);
        logger.error("proxy.error", { error: err.message, target, path: req.originalUrl });
        if (!res.headersSent) {
          res.status(502).json({ error: "bad_gateway", message: "Downstream unavailable", requestId: reqId });
        }
      });

      if (body) {
        proxyReq.write(body);
      }
      proxyReq.end();
    }
  };
}
