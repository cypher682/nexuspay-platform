import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("../src/lib/redis", () => ({
  incrementVelocity: jest.fn(async () => 0)
}));

jest.mock("../src/lib/prisma", () => ({
  prisma: {
    fraudRule: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn()
    },
    fraudCheck: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      aggregate: jest.fn()
    }
  }
}));

import { prisma } from "../src/lib/prisma";
import { env } from "../src/config/env";
import { createApp } from "../src/app";

const db = prisma as unknown as {
  fraudRule: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  fraudCheck: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    groupBy: jest.Mock;
    aggregate: jest.Mock;
  };
};

const RULES = [
  {
    id: "rule_amount_threshold",
    name: "amount_threshold",
    type: "AMOUNT_THRESHOLD",
    enabled: true,
    score: 60,
    config: { maxAmountMinor: 1_000_000 },
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: "rule_velocity",
    name: "velocity_5_per_5m",
    type: "VELOCITY",
    enabled: true,
    score: 60,
    config: { windowSeconds: 300, maxChecks: 5 },
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: "rule_denylist",
    name: "denylist",
    type: "DENYLIST",
    enabled: true,
    score: 100,
    config: { userIds: [], emails: [] },
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

const INTERNAL_KEY = "test-internal-api-key-value";

function token(scopes: string[]): string {
  return jwt.sign({ sub: "user-admin", type: "access", email: "admin@nexuspay.local", scopes }, env.JWT_SECRET, {
    algorithm: "HS256",
    issuer: env.MFA_ISSUER,
    expiresIn: "5m"
  });
}

const app = createApp();

beforeEach(() => {
  jest.clearAllMocks();
  db.fraudRule.findMany.mockResolvedValue(RULES);
  db.fraudRule.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
    RULES.find((rule) => rule.id === where.id) ?? null
  );
  db.fraudRule.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({
    ...RULES.find((rule) => rule.id === where.id),
    ...data
  }));
  db.fraudCheck.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: "check-1",
    createdAt: new Date(),
    ...data
  }));
  db.fraudCheck.findMany.mockResolvedValue([]);
  db.fraudCheck.count.mockResolvedValue(0);
  db.fraudCheck.groupBy.mockResolvedValue([]);
  db.fraudCheck.aggregate.mockResolvedValue({ _avg: { latencyMs: 0 } });
});

describe("POST /v1/fraud/check", () => {
  it("allows a low-risk payment for the internal caller", async () => {
    const response = await request(app)
      .post("/v1/fraud/check")
      .set("x-internal-api-key", INTERNAL_KEY)
      .send({ paymentId: "pay_1", userId: "user-1", amountMinor: 5000, currency: "NGN" });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ decision: "ALLOW", score: 0, userId: "user-1" });
  });

  it("reviews a payment above the amount threshold", async () => {
    const response = await request(app)
      .post("/v1/fraud/check")
      .set("x-internal-api-key", INTERNAL_KEY)
      .send({ userId: "user-1", amountMinor: 2_000_000, currency: "NGN" });

    expect(response.status).toBe(201);
    expect(response.body.decision).toBe("REVIEW");
    expect(response.body.reasons).toContain("amount_threshold");
  });

  it("rejects a missing internal key", async () => {
    const response = await request(app)
      .post("/v1/fraud/check")
      .send({ userId: "user-1", amountMinor: 1000 });

    expect(response.status).toBe(401);
  });

  it("rejects an invalid payload", async () => {
    const response = await request(app)
      .post("/v1/fraud/check")
      .set("x-internal-api-key", INTERNAL_KEY)
      .send({ userId: "user-1", amountMinor: -5 });

    expect(response.status).toBe(422);
  });
});

describe("admin endpoints", () => {
  it("lists rules for a fraud admin", async () => {
    const response = await request(app)
      .get("/v1/fraud/rules")
      .set("authorization", `Bearer ${token(["fraud:admin"])}`);

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(3);
  });

  it("rejects a user without the fraud:admin scope", async () => {
    const response = await request(app)
      .get("/v1/fraud/rules")
      .set("authorization", `Bearer ${token(["payments:create"])}`);

    expect(response.status).toBe(403);
  });

  it("accepts a wildcard admin scope", async () => {
    const response = await request(app)
      .get("/v1/fraud/stats")
      .set("authorization", `Bearer ${token(["*"])}`);

    expect(response.status).toBe(200);
    expect(response.body.byDecision).toEqual({ ALLOW: 0, REVIEW: 0, BLOCK: 0 });
  });

  it("rejects a config that does not match the rule type", async () => {
    const response = await request(app)
      .patch("/v1/fraud/rules/rule_velocity")
      .set("authorization", `Bearer ${token(["*"])}`)
      .send({ config: { maxChecks: -10 } });

    expect(response.status).toBe(422);
  });

  it("updates a rule for an admin", async () => {
    const response = await request(app)
      .patch("/v1/fraud/rules/rule_amount_threshold")
      .set("authorization", `Bearer ${token(["*"])}`)
      .send({ enabled: false });

    expect(response.status).toBe(200);
    expect(db.fraudRule.update).toHaveBeenCalled();
  });
});
