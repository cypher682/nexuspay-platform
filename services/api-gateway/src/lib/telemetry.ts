import { context, isSpanContextValid, trace } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ExpressInstrumentation } from "@opentelemetry/instrumentation-express";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { env } from "../config/env";

let sdk: NodeSDK | null = null;

export interface TraceMetadata {
  traceId: string;
  spanId: string;
}

/**
 * Initialises the OpenTelemetry SDK. Must run BEFORE the express app is
 * imported so instrumentation can wrap it. Safe to call once only.
 */
export function initTelemetry(serviceName: string, serviceVersion: string): void {
  if (!env.OTEL_TRACES_ENABLED || sdk) return;

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "service.version": serviceVersion
    }),
    traceExporter: new OTLPTraceExporter({ url: env.OTEL_TRACES_ENDPOINT }),
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()]
  });
  sdk.start();
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown().catch(() => undefined);
    sdk = null;
  }
}

/** Returns the active trace/span ids for log correlation, or null when no span is active. */
export function getTraceMetadata(): TraceMetadata | null {
  const span = trace.getSpan(context.active());
  if (span === undefined) return null;
  const { traceId, spanId } = span.spanContext();
  if (!isSpanContextValid({ traceId, spanId, traceFlags: 1 })) return null;
  return { traceId, spanId };
}