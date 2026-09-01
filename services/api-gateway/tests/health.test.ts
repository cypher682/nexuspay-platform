import request from "supertest";

jest.mock("../src/lib/redis", () => {
  const sortedSets = new Map<string, Array<{ score: number; member: string }>>();

  function makeMulti() {
    const commands: Array<[string, unknown[]]> = [];
    const api = {
      zremrangebyscore: (...args: unknown[]) => {
        commands.push(["zremrangebyscore", args]);
        return api;
      },
      zadd: (key: string, score: string, member: string) => {
        const set = sortedSets.get(key) ?? [];
        set.push({ score: Number(score), member });
        sortedSets.set(key, set);
        return api;
      },
      zcard: (key: string) => {
        commands.push(["zcard", [key]]);
        return api;
      },
      pexpire: () => api,
      exec: async () =>
        Promise.all(
          commands.map(([name, args]) => {
            if (name === "zcard") return [null, sortedSets.get(String(args[0]))?.length ?? 0];
            return [null, 1];
          })
        )
    };
    return api;
  }

  const redisMock = {
    ping: jest.fn(async () => "PONG"),
    multi: makeMulti,
    zrem: async () => 1,
    status: "ready",
    on: jest.fn(),
    quit: jest.fn(async () => undefined),
    disconnect: jest.fn()
  };

  return { redis: redisMock, closeRedis: jest.fn(async () => undefined) };
});

describe("api-gateway contract", () => {
  let createApp: typeof import("../src/app").createApp;
  let app: ReturnType<typeof import("../src/app").createApp>;

  beforeAll(async () => {
    ({ createApp } = await import("../src/app"));
    app = createApp();
  });

  it("GET /health returns service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("api-gateway");
  });

  it("propagates X-Request-Id and sets response header", async () => {
    const res = await request(app)
      .get("/v1/payments")
      .set("X-Request-Id", "req-fixed-123");
    expect(res.headers["x-request-id"]).toBe("req-fixed-123");
  });

  it("rejects protected route without bearer token", async () => {
    const res = await request(app).get("/v1/payments");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("request_failed");
  });

  it("returns rate limit headers on requests", async () => {
    const res = await request(app).get("/v1/auth/login").send({});
    expect(Number(res.headers["ratelimit-limit"])).toBeGreaterThan(0);
    expect(res.headers["ratelimit-remaining"]).toBeDefined();
  });

  it("aggregation endpoint rejects unauthenticated callers", async () => {
    const res = await request(app).get("/v1/me/summary");
    expect(res.status).toBe(401);
  });
});
