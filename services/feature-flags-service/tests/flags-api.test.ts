import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";

jest.mock("../src/lib/prisma", () => {
  interface StoredFlag {
    id: string;
    key: string;
    description: string | null;
    enabled: boolean;
    rolloutPercent: number;
    variants: string[];
    allowlist: string[];
    environment: string;
    createdBy: string | null;
    updatedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }

  const state: { flags: StoredFlag[]; audit: Record<string, unknown>[]; seq: number } = {
    flags: [],
    audit: [],
    seq: 0
  };

  const composite = (where: { environment_key?: { environment: string; key: string } }) => {
    const key = where.environment_key;
    if (!key) return undefined;
    return state.flags.find(
      (flag) => flag.environment === key.environment && flag.key === key.key
    );
  };

  const prisma = {
    $queryRaw: jest.fn(async () => [{ "?column?": 1 }]),
    $disconnect: jest.fn(),
    flag: {
      findUnique: jest.fn(async ({ where }: { where: never }) => composite(where) ?? null),
      findMany: jest.fn(
        async ({
          where,
          take
        }: {
          where: { environment: string; key?: { in: string[] } };
          take?: number;
        }) => {
          let rows = state.flags.filter((flag) => flag.environment === where.environment);
          if (where.key?.in) rows = rows.filter((flag) => where.key!.in.includes(flag.key));
          rows = [...rows].sort((a, b) => a.key.localeCompare(b.key));
          return typeof take === "number" ? rows.slice(0, take) : rows;
        }
      ),
      create: jest.fn(async ({ data }: { data: Partial<StoredFlag> }) => {
        const now = new Date();
        const flag: StoredFlag = {
          id: `flag_${++state.seq}`,
          key: data.key as string,
          description: data.description ?? null,
          enabled: data.enabled ?? false,
          rolloutPercent: data.rolloutPercent ?? 0,
          variants: data.variants ?? [],
          allowlist: data.allowlist ?? [],
          environment: data.environment ?? "prod",
          createdBy: data.createdBy ?? null,
          updatedBy: data.updatedBy ?? null,
          createdAt: now,
          updatedAt: now
        };
        state.flags.push(flag);
        return flag;
      }),
      update: jest.fn(async ({ where, data }: { where: never; data: Partial<StoredFlag> }) => {
        const flag = composite(where);
        if (!flag) throw new Error("not found");
        Object.assign(flag, data, { updatedAt: new Date() });
        return flag;
      }),
      delete: jest.fn(async ({ where }: { where: never }) => {
        const flag = composite(where);
        if (!flag) throw new Error("not found");
        state.flags = state.flags.filter((row) => row.id !== flag.id);
        return flag;
      })
    },
    flagAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.audit.push(data);
        return data;
      }),
      findMany: jest.fn(async ({ where, take }: { where: { flagKey: string }; take?: number }) => {
        const rows = state.audit.filter((row) => row.flagKey === where.flagKey);
        return typeof take === "number" ? rows.slice(0, take) : rows;
      })
    }
  };

  return { prisma, __state: state };
});

const { __state } = jest.requireMock("../src/lib/prisma") as {
  __state: { flags: unknown[]; audit: unknown[]; seq: number };
};

const ISSUER = "NexusPay";

function token(scopes: string[], sub = "user-1"): string {
  return jwt.sign({ sub, type: "access", email: `${sub}@example.com`, scopes, iss: ISSUER }, "test-secret-value-at-least-32-chars", {
    algorithm: "HS256",
    expiresIn: "10m"
  });
}

const adminToken = () => token(["*"], "admin-1");
const userToken = () => token(["payments:create", "payments:read"], "user-1");

describe("feature flags API", () => {
  const app = createApp();

  beforeEach(() => {
    __state.flags.length = 0;
    __state.audit.length = 0;
    __state.seq = 0;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/v1/flags");
    expect(res.status).toBe(401);
  });

  it("forbids flag creation for non-admin users", async () => {
    const res = await request(app)
      .post("/v1/flags")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ key: "new-checkout" });
    expect(res.status).toBe(403);
  });

  it("creates, lists, reads, updates and deletes a flag", async () => {
    const admin = `Bearer ${adminToken()}`;

    const created = await request(app)
      .post("/v1/flags")
      .set("Authorization", admin)
      .send({
        key: "checkout-redesign",
        description: "New checkout flow",
        rolloutPercent: 25,
        variants: ["control", "treatment"]
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      key: "checkout-redesign",
      environment: "prod",
      enabled: false,
      rolloutPercent: 25,
      variants: ["control", "treatment"]
    });

    const list = await request(app).get("/v1/flags").set("Authorization", admin);
    expect(list.status).toBe(200);
    expect(list.body.count).toBe(1);

    const fetched = await request(app)
      .get("/v1/flags/checkout-redesign")
      .set("Authorization", admin);
    expect(fetched.status).toBe(200);
    expect(fetched.body.key).toBe("checkout-redesign");

    const updated = await request(app)
      .patch("/v1/flags/checkout-redesign")
      .set("Authorization", admin)
      .send({ enabled: true, rolloutPercent: 100 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ enabled: true, rolloutPercent: 100 });

    const audit = await request(app)
      .get("/v1/flags/checkout-redesign/audit")
      .set("Authorization", admin);
    expect(audit.status).toBe(200);
    expect(audit.body.entries.length).toBe(2);

    const removed = await request(app)
      .delete("/v1/flags/checkout-redesign")
      .set("Authorization", admin);
    expect(removed.status).toBe(204);

    const missing = await request(app)
      .get("/v1/flags/checkout-redesign")
      .set("Authorization", admin);
    expect(missing.status).toBe(404);
  });

  it("returns 409 when the same key exists in an environment", async () => {
    const admin = `Bearer ${adminToken()}`;
    await request(app).post("/v1/flags").set("Authorization", admin).send({ key: "dup-key" });
    const again = await request(app)
      .post("/v1/flags")
      .set("Authorization", admin)
      .send({ key: "dup-key" });
    expect(again.status).toBe(409);
  });

  it("validates flag keys", async () => {
    const res = await request(app)
      .post("/v1/flags")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ key: "Not Valid!" });
    expect(res.status).toBe(422);
  });

  it("evaluates a single flag for the authenticated subject", async () => {
    await request(app)
      .post("/v1/flags")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ key: "checkout-redesign", enabled: true, rolloutPercent: 100 });

    const res = await request(app)
      .post("/v1/flags/checkout-redesign/evaluate")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ key: "checkout-redesign", enabled: true, reason: "rollout" });
    expect(res.body.subjectId).toBe("user-1");
  });

  it("evaluates a batch and reports missing flags", async () => {
    await request(app)
      .post("/v1/flags")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ key: "checkout-redesign", enabled: true, rolloutPercent: 100 });

    const res = await request(app)
      .post("/v1/flags/evaluate")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ keys: ["checkout-redesign", "does-not-exist"], subjectId: "user-99" });
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      (res.body.evaluations as { key: string; enabled: boolean; reason: string }[]).map((e) => [
        e.key,
        e
      ])
    );
    expect(byKey["checkout-redesign"]).toMatchObject({ enabled: true, reason: "rollout" });
    expect(byKey["does-not-exist"]).toMatchObject({ enabled: false, reason: "flag_not_found" });
  });

  it("treats unknown flags on single evaluation as disabled, not an error", async () => {
    const res = await request(app)
      .post("/v1/flags/nope/evaluate")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, reason: "flag_not_found" });
  });

  it("reports readiness with a database check", async () => {
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe("ok");
  });
});
