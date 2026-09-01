import winston from "winston";
import { env } from "../config/env";
import { getTraceMetadata } from "./telemetry";

const traceContext = winston.format((info) => {
  const trace = getTraceMetadata();
  if (trace) {
    info.trace_id = trace.traceId;
    info.span_id = trace.spanId;
  }
  return info;
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: { service: "payments-service" },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    traceContext(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()]
});

export const stream = {
  write: (message: string) => {
    logger.http(message.trim());
  }
};
