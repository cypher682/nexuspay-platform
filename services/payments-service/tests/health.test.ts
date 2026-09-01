import request from "supertest";
import crypto from "node:crypto";

const redisStore = new Map<string, string>();
(globalThis as Record<string, unknown>).__paymentsRedisStore = redisStore;

jest.mock("../src/lib/redis", () => {
  const store =
    (globalThis as Record<string, unknown>).__paymentsRedisStore as Map<string, string>;
  return {
    redis: {
      ping: jest.fn(async () => "PONG"),
      set: jest.fn(
        async (key: string, value: string, _mode?: string, _ttl?: number, nx?: string) =>
          nx === "NX" ? (store.has(key) ? null : "OK") : "OK"
      ),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (...keys: string[]) => {
        let removed = 0;
        for (const key of keys) if (store.delete(key)) removed += 1;
        return removed;
      }),
      status: "ready",
      on: jest.fn(),
      quit: jest.fn(async () => undefined),
      disconnect: jest.fn()
    },
    bullMqConnectionOptions: jest.fn(() => ({ host: "localhost", port: 6379 })),
    closeRedis: jest.fn(async () => undefined)
  };
});

const prismaMock = {
  $queryRaw: jest.fn(),
  $disconnect: jest.fn(),
  payment: { findUnique: jest.fn(), findMany: jest.fn() },
  idempotencyRecord: { findUnique: jest.fn(), create: jest.fn() },
  webhookEvent: {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockResolvedValue({ eventId: "evt_ok_1", type: "payment.succeeded", processedAt: null }),
    update: jest.fn().mockResolvedValue({})
  }
};

jest.mock("../src/lib/prisma", () => ({
  prisma: (globalThis as Record<string, unknown>).__prismaMock
}));

(globalThis as Record<string, unknown>).__prismaMock = prismaMock;

jest.mock("../src/queues", () => ({
  paymentProcessingQueue: { add: jest.fn(async () => undefined) }
}));

describe("payments-service contract", () => {
  let createApp: typeof import("../src/app").createApp;
  let app: ReturnType<typeof import("../src/app").createApp>;

  const tokenFor = (sub: string, scopes: string[] = []) => {
    const jwt = require("jsonwebtoken");
    return jwt.sign(
      { sub, type: "access", scopes, iss: process.env.AUTH_ISSUER ?? "NexusPay" },
      process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars",
      { algorithm: "HS256", expiresIn: "5m" }
    );
  };

  const webhookSignature = (body: string) =>
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.PROVIDER_WEBHOOK_SECRET ?? "test-webhook-secret-value")
      .update(body)
      .digest("hex");

  beforeAll(() => {
    ({ createApp } = require("../src/app"));
    app = createApp();
  });

  beforeEach(() => {
    redisStore.clear();
    prismaMock.idempotencyRecord.findUnique.mockReset().mockResolvedValue(null);
    prismaMock.idempotencyRecord.create.mockReset().mockResolvedValue({});
  });

  it("GET /health returns service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("payments-service");
  });

  it("rejects payment creation without bearer token", async () => {
    const res = await request(app)
      .post("/v1/payments")
      .set("Idempotency-Key", "test-key-1234")
      .send({ amountMinor: 5000, provider: "MOCK_CARD" });
    expect(res.status).toBe(401);
  });

  it("rejects payment creation without Idempotency-Key", async () => {
    const res = await request(app)
      .post("/v1/payments")
      .set("Authorization", `Bearer ${tokenFor("user_1")}`)
      .send({ amountMinor: 5000, provider: "MOCK_CARD" });
    expect(res.status).toBe(422);
  });

  it("rejects negative amounts via Zod schema", async () => {
    const res = await request(app)
      .post("/v1/payments")
      .set("Authorization", `Bearer ${tokenFor("user_1")}`)
      .set("Idempotency-Key", "test-key-5678")
      .send({ amountMinor: -100, provider: "MOCK_CARD" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_error");
  });

  it("rejects refund without payments:refund scope", async () => {
    const res = await request(app)
      .post("/v1/payments/pay_123/refund")
      .set("Authorization", `Bearer ${tokenFor("user_1", ["payments:create"])}`);
    expect(res.status).toBe(403);
  });

  it("accepts webhook with valid HMAC signature", async () => {
    const body = JSON.stringify({ eventId: "evt_ok_1", type: "payment.succeeded" });
    const res = await request(app)
      .post("/v1/webhooks/provider")
      .set("Content-Type", "application/json")
      .set("X-NexusPay-Signature", webhookSignature(body))
      .send(Buffer.from(body));
    expect(res.status).toBe(202);
    expect(res.body.received).toBe(true);
  });

  it("rejects webhook with invalid HMAC signature", async () => {
    const body = JSON.stringify({ eventId: "evt_bad_1", type: "payment.succeeded" });
    const res = await request(app)
      .post("/v1/webhooks/provider")
      .set("Content-Type", "application/json")
      .set("X-NexusPay-Signature", "sha256=deadbeef")
      .send(Buffer.from(body));
    expect(res.status).toBe(401);
  });
});
