import { env } from "../config/env";
import { logger } from "./logger";
import { CircuitOpenError, withBreaker } from "./circuit-breaker";

export interface DownstreamResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

export interface DownstreamOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  breakerService?: string;
}

export async function callDownstream<T>(
  service: string,
  url: string,
  options: DownstreamOptions = {}
): Promise<DownstreamResult<T>> {
  const {
    method = "GET",
    body,
    headers = {},
    timeoutMs = env.DOWNSTREAM_TIMEOUT_MS,
    breakerService = service
  } = options;

  return withBreaker(breakerService, async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      if (err instanceof CircuitOpenError) throw err;
      logger.warn("downstream.unreachable", { service, url, error: (err as Error).message });
      return { ok: false, status: 0, data: null };
    }

    if (!response.ok) {
      logger.warn("downstream.error_response", { service, url, status: response.status });
      return { ok: false, status: response.status, data: null };
    }

    try {
      const data = (await response.json()) as T;
      return { ok: true, status: response.status, data };
    } catch {
      logger.warn("downstream.bad_json", { service, url });
      return { ok: false, status: response.status, data: null };
    }
  });
}
