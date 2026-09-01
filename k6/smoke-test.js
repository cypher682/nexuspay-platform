import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";

export const options = {
  vus: 1,
  duration: "10s",
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.1"],
  },
};

export default function () {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    "health returns 200": (r) => r.status === 200,
    "health body has status ok": (r) => JSON.parse(r.body).status === "ok",
  });

  // Public OpenAPI spec served by the gateway
  const specRes = http.get(`${BASE_URL}/docs/openapi.json`);
  check(specRes, {
    "openapi spec returns 200": (r) => r.status === 200,
    "spec body is YAML": (r) => typeof r.body === "string" && r.body.length > 100,
  });

  sleep(1);
}
