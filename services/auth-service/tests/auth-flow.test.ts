import request from "supertest";

jest.mock("../src/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(),
    $disconnect: jest.fn()
  }
}));

jest.mock("../src/lib/redis", () => {
  const store = new Map<string, string>();
  const client = {
    ping: jest.fn(async () => "PONG"),
    exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    incr: jest.fn(async (key: string) => {
      const next = (Number(store.get(key) ?? 0) + 1);
      store.set(key, String(next));
      return next;
    }),
    expire: jest.fn(async () => 1),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return "OK";
    }),
    del: jest.fn(async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
      }
      return removed;
    }),
    status: "ready",
    on: jest.fn(),
    quit: jest.fn(async () => undefined),
    disconnect: jest.fn()
  };
  return { redis: client, closeRedis: jest.fn(async () => undefined) };
});

const authFlow = require("../src/app");

describe("auth API contract", () => {
  let app: ReturnType<typeof authFlow.createApp>;

  beforeAll(() => {
    app = authFlow.createApp();
  });

  describe("validation", () => {
    it("rejects registration with weak password", async () => {
      const res = await request(app)
        .post("/v1/auth/register")
        .send({ email: "user@example.com", password: "short" });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("validation_error");
    });

    it("rejects malformed email", async () => {
      const res = await request(app)
        .post("/v1/auth/register")
        .send({ email: "not-an-email", password: "Sup3rSecurePass" });
      expect(res.status).toBe(422);
    });

    it("rejects login without required fields", async () => {
      const res = await request(app).post("/v1/auth/login").send({});
      expect(res.status).toBe(422);
    });

    it("rejects MFA verify with non-numeric code", async () => {
      const res = await request(app)
        .post("/v1/auth/mfa/verify")
        .send({ challengeToken: "x".repeat(30), code: "abc123" });
      expect(res.status).toBe(422);
    });

    it("rejects refresh with short token body", async () => {
      const res = await request(app).post("/v1/auth/refresh").send({ refreshToken: "tiny" });
      expect(res.status).toBe(422);
    });
  });

  describe("error contract", () => {
    it("maps HttpError to structured JSON", async () => {
      const res = await request(app).post("/v1/auth/refresh").send({
        refreshToken: Buffer.alloc(40, "a").toString()
      });
      expect([401]).toContain(res.status);
      expect(res.body.requestId).toBeDefined();
    });

    it("requires bearer token on protected user routes", async () => {
      const res = await request(app).get("/v1/users/me");
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/bearer/i);
    });

    it("rejects non-access JWT types on protected routes", async () => {
      const jwt = require("jsonwebtoken");
      const token = jwt.sign(
        { sub: "user_1", type: "refresh", family_id: "fam_1", iss: "NexusPay" },
        process.env.JWT_SECRET ?? "test-secret-value-at-least-32-chars",
        { algorithm: "HS256", expiresIn: "5m" }
      );
      const res = await request(app).get("/v1/users/me").set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(401);
    });
  });
});
