import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const paymentFailRate = new Rate("payment_failures");
const paymentDuration = new Trend("payment_duration", true);

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const EMAIL = __ENV.TEST_EMAIL || "k6payment@test.dev";
const PASSWORD = __ENV.TEST_PASSWORD || "K6PayPass123!";

let accessToken = "";

export function setup() {
  // Login as a pre-seeded, verified user (see scripts/seed-test-user.ts).
  // Registration is intentionally NOT run here (see auth-login.js notes).
  const loginRes = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  if (loginRes.status === 200) {
    return { token: JSON.parse(loginRes.body).accessToken };
  }
  return { token: "" };
}

export const options = {
  stages: [
    { duration: "10s", target: 3 },
    { duration: "30s", target: 3 },
    { duration: "10s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<5000"],
    payment_failures: ["rate<0.15"],
    payment_duration: ["p(95)<4000"],
  },
};

export default function (data) {
  const token = data.token || accessToken;
  if (!token) return;

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "Idempotency-Key": `k6-${__VU}-${__ITER}-${Date.now()}`,
  };

  // Create payment
  const createRes = http.post(
    `${BASE_URL}/v1/payments`,
    JSON.stringify({
      amountMinor: Math.floor(Math.random() * 50000) + 100,
      currency: "NGN",
      provider: "MOCK_TRANSFER",
      metadata: { source: "k6-load-test" },
    }),
    { headers }
  );

  const createOk = check(createRes, {
    "payment created (201)": (r) => r.status === 201,
    "payment has id": (r) => {
      try { return JSON.parse(r.body).id !== undefined; }
      catch (err) { return false; }
    },
  });

  paymentFailRate.add(!createOk);
  paymentDuration.add(createRes.timings.duration);

  if (createOk) {
    const payment = JSON.parse(createRes.body);

    // Get payment by ID
    const getRes = http.get(`${BASE_URL}/v1/payments/${payment.id}`, { headers });
    check(getRes, {
      "get payment returns 200": (r) => r.status === 200,
    });

    // List payments
    const listRes = http.get(`${BASE_URL}/v1/payments?limit=5`, { headers });
    check(listRes, {
      "list payments returns 200": (r) => r.status === 200,
      "list has payments array": (r) => {
        try { return Array.isArray(JSON.parse(r.body).payments); }
        catch (err) { return false; }
      },
    });
  }

  sleep(1);
}
