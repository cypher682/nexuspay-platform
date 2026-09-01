import request from "supertest";

const prismaMock = (globalThis as Record<string, unknown>).__prismaMock as {
  $queryRaw: jest.Mock;
  template: { findUnique: jest.Mock; findMany: jest.Mock; upsert: jest.Mock };
  notification: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
};

(globalThis as Record<string, unknown>).__prismaMock = {
  $queryRaw: jest.fn(),
  template: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
  notification: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn()
  }
};

jest.mock("../src/lib/prisma", () => ({
  prisma: (globalThis as Record<string, unknown>).__prismaMock
}));

jest.mock("../src/lib/rabbitmq", () => ({
  publishNotification: jest.fn(async () => undefined),
  startConsumer: jest.fn(async () => undefined),
  closeRabbit: jest.fn(async () => undefined),
  getChannel: jest.fn(async () => ({ prefetch: jest.fn(), consume: jest.fn() }))
}));

describe("notifications-service contract", () => {
  let createApp: typeof import("../src/app").createApp;
  let app: ReturnType<typeof import("../src/app").createApp>;

  beforeAll(() => {
    ({ createApp } = require("../src/app"));
    app = createApp();
  });

  const apiKey = process.env.INTERNAL_API_KEY ?? "test-internal-api-key-value";

  it("GET /health is public and returns service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("notifications-service");
  });

  it("rejects /v1 without internal API key", async () => {
    const res = await request(app).get("/v1/notifications");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/internal api key/i);
  });

  it("rejects invalid channel enum with 422", async () => {
    const res = await request(app)
      .post("/v1/notifications")
      .set("X-Internal-Api-Key", apiKey)
      .send({ channel: "PIGEON", templateKey: "welcome_email", recipient: "a@b.com", payload: {} });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_error");
  });

  it("returns 404 for unknown template on enqueue", async () => {
    prismaMock.template.findUnique.mockResolvedValue(null);
    const res = await request(app)
      .post("/v1/notifications")
      .set("X-Internal-Api-Key", apiKey)
      .send({
        channel: "EMAIL",
        templateKey: "missing_template",
        recipient: "user@example.com",
        payload: {}
      });
    expect(res.status).toBe(404);
  });
});
