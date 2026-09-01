import { env } from "../config/env";

type BreakerState = "closed" | "open" | "half_open";

interface BreakerEntry {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number | null;
}

const breakers = new Map<string, BreakerEntry>();

function entryFor(name: string): BreakerEntry {
  let entry = breakers.get(name);
  if (!entry) {
    entry = { state: "closed", consecutiveFailures: 0, openedAt: null };
    breakers.set(name, entry);
  }
  return entry;
}

export class CircuitOpenError extends Error {
  constructor(public readonly service: string) {
    super(`Circuit breaker open for ${service}`);
    this.name = "CircuitOpenError";
  }
}

function canAttempt(entry: BreakerEntry): boolean {
  if (entry.state === "closed") return true;
  if (entry.state === "half_open") return true;
  const elapsedMs = Date.now() - (entry.openedAt ?? 0);
  if (elapsedMs >= env.CIRCUIT_BREAKER_OPEN_SECONDS * 1000) {
    entry.state = "half_open";
    return true;
  }
  return false;
}

export async function withBreaker<T>(
  service: string,
  operation: () => Promise<T>
): Promise<T> {
  const entry = entryFor(service);

  if (!canAttempt(entry)) {
    throw new CircuitOpenError(service);
  }

  try {
    const result = await operation();
    entry.consecutiveFailures = 0;
    entry.state = "closed";
    entry.openedAt = null;
    return result;
  } catch (err) {
    entry.consecutiveFailures += 1;
    if (
      entry.consecutiveFailures >= env.CIRCUIT_BREAKER_FAILURE_THRESHOLD ||
      entry.state === "half_open"
    ) {
      entry.state = "open";
      entry.openedAt = Date.now();
    }
    throw err;
  }
}
