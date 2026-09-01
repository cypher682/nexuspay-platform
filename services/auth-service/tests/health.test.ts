import request from "supertest";
import { createApp } from "../src/app";

describe("health endpoints", () => {
  const app = createApp();

  it("GET /health returns service info", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", service: "auth-service" });
  });

  it("GET /v1 returns endpoint index", async () => {
    const res = await request(app).get("/v1");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("auth-service");
  });

  it("unknown routes return 404 with request id", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.requestId).toBeDefined();
  });
});
