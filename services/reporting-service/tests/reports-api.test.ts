import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app";
import { queryPayments } from "../src/lib/payments-db";

interface SnapshotRow {
  id: string;
  day: Date;
  currency: string;
  succeededCount: number;
  failedCount: number;
  refundedCount: number;
  grossVolumeMinor: bigint;
  refundedVolumeMinor: bigint;
  createdAt: Date;
  updatedAt: Date;
}

interface RunRow {
  id: string;
  status: string;
  fromDay: Date;
  toDay: Date;
  rowsWritten: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

const state: { snapshots: SnapshotRow[]; runs: RunRow[]; seq: number } = {
  snapshots: [],
  runs: [],
  seq: 0
};

jest.mock("../src/lib/prisma", () => ({
  prisma: {
    $queryRaw: jest.fn(async () => [{ ok: 1 }]),
    $disconnect: jest.fn(),
    reportRun: {
      create: jest.fn(async ({ data }: { data: Partial<RunRow> }) => {
        const run: RunRow = {
          id: `run_${++state.seq}`,
          status: "RUNNING",
          fromDay: new Date(),
          toDay: new Date(),
          rowsWritten: 0,
          error: null,
          startedAt: new Date(),
          finishedAt: null,
          ...data
        } as RunRow;
        state.runs.unshift(run);
        return run;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<RunRow> }) => {
        const run = state.runs.find((item) => item.id === where.id);
        if (!run) throw new Error("run not found");
        Object.assign(run, data);
        return run;
      }),
      findMany: jest.fn(async ({ take }: { take?: number }) =>
        typeof take === "number" ? state.runs.slice(0, take) : state.runs
      )
    },
    dailyPaymentSnapshot: {
      upsert: jest.fn(
        async ({
          where,
          create,
          update
        }: {
          where: { day_currency: { day: Date; currency: string } };
          create: Partial<SnapshotRow>;
          update: Partial<SnapshotRow>;
        }) => {
          const existing = state.snapshots.find(
            (row) =>
              row.day.getTime() === where.day_currency.day.getTime() &&
              row.currency === where.day_currency.currency
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row: SnapshotRow = {
            id: `snap_${++state.seq}`,
            createdAt: new Date(),
            updatedAt: new Date(),
            ...create
          } as SnapshotRow;
          state.snapshots.push(row);
          return row;
        }
      ),
      findMany: jest.fn(
        async ({
          where
        }: {
          where: { day: { gte: Date; lt: Date }; currency?: string };
        }) =>
          state.snapshots.filter(
            (row) =>
              row.day >= where.day.gte &&
              row.day < where.day.lt &&
              (!where.currency || row.currency === where.currency)
          )
      )
    }
  }
}));

jest.mock("../src/lib/payments-db", () => ({
  queryPayments: jest.fn(),
  paymentsPool: { end: jest.fn() }
}));

const mockedQueryPayments = queryPayments as unknown as jest.Mock;

const app = createApp();
const JWT_SECRET = "test-secret-value-at-least-32-chars";

function token(scopes: string[]): string {
  return jwt.sign({ sub: "user-1", type: "access", scopes }, JWT_SECRET);
}

function auth(scopes: string[]) {
  return { Authorization: `Bearer ${token(scopes)}` };
}

beforeEach(() => {
  state.snapshots.length = 0;
  state.runs.length = 0;
  mockedQueryPayments.mockReset();
});

describe("reporting API", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/v1/reports/payments/daily");
    expect(res.status).toBe(401);
  });

  it("rejects readers on refresh", async () => {
    const res = await request(app)
      .post("/v1/reports/refresh")
      .set(auth(["reports:read"]))
      .send({ from: "2026-10-01", to: "2026-10-03" });
    expect(res.status).toBe(403);
  });

  it("refreshes snapshots for an admin and records a successful run", async () => {
    mockedQueryPayments.mockResolvedValueOnce([
      {
        day: "2026-10-01",
        currency: "NGN",
        succeeded_count: "4",
        failed_count: "1",
        refunded_count: "1",
        gross_volume_minor: "90000",
        refunded_volume_minor: "10000"
      }
    ]);

    const res = await request(app)
      .post("/v1/reports/refresh")
      .set(auth(["*"]))
      .send({ from: "2026-10-01", to: "2026-10-02" });

    expect(res.status).toBe(202);
    expect(res.body.rowsWritten).toBe(1);
    expect(state.snapshots).toHaveLength(1);
    expect(state.snapshots[0].grossVolumeMinor).toBe(BigInt(90000));
    expect(state.runs[0].status).toBe("SUCCEEDED");
    expect(state.runs[0].rowsWritten).toBe(1);
  });

  it("returns daily rows and CSV export for a reader", async () => {
    state.snapshots.push({
      id: "snap_x",
      day: new Date("2026-10-01T00:00:00.000Z"),
      currency: "NGN",
      succeededCount: 2,
      failedCount: 0,
      refundedCount: 0,
      grossVolumeMinor: BigInt(50000),
      refundedVolumeMinor: BigInt(0),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const daily = await request(app)
      .get("/v1/reports/payments/daily?from=2026-10-01&to=2026-10-03")
      .set(auth(["reports:read"]));
    expect(daily.status).toBe(200);
    expect(daily.body.count).toBe(1);
    expect(daily.body.rows[0].grossVolumeMinor).toBe("50000");

    const csv = await request(app)
      .get("/v1/reports/payments/daily.csv?from=2026-10-01&to=2026-10-03")
      .set(auth(["reports:read"]));
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text).toContain("2026-10-01,NGN,2,0,0,50000,0");
  });

  it("rejects an inverted date range", async () => {
    const res = await request(app)
      .get("/v1/reports/payments/daily?from=2026-10-05&to=2026-10-01")
      .set(auth(["reports:read"]));
    expect(res.status).toBe(422);
  });

  it("marks the run failed when the payments query throws", async () => {
    mockedQueryPayments.mockRejectedValueOnce(new Error("payments db down"));
    const res = await request(app)
      .post("/v1/reports/refresh")
      .set(auth(["*"]))
      .send({ from: "2026-10-01", to: "2026-10-02" });
    expect(res.status).toBe(500);
    expect(state.runs[0].status).toBe("FAILED");
    expect(state.runs[0].error).toContain("payments db down");
  });
});
