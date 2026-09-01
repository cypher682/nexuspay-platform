import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const loginFailRate = new Rate("login_failures");
const loginDuration = new Trend("login_duration", true);

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const EMAIL = __ENV.TEST_EMAIL || "k6load@test.dev";
const PASSWORD = __ENV.TEST_PASSWORD || "K6LoadPass123!";

export const options = {
  stages: [
    { duration: "10s", target: 2 },   // ramp up
    { duration: "30s", target: 2 },   // sustained load
    { duration: "10s", target: 0 },    // ramp down
  ],
  thresholds: {
    // Tight failure bar: no gateway circuit-breaker cascade (503s) allowed.
    login_failures: ["rate<0.05"],
    // Latency reflects bcryptjs (pure-JS) cost on a single local worker.
    // The ~2->3 VU cliff (circuit tripping) is the key finding — see
    // docs/k6-load-testing.md.
    http_req_duration: ["p(95)<4000"],
    login_duration: ["p(95)<4000"],
  },
};

export default function () {
  // Login as a pre-seeded, verified user (see scripts/seed-test-user.ts).
  // Registration is intentionally NOT run here: creating users in the load
  // path would race on the unique email and trip the auth rate limiter.
  const loginRes = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" } }
  );

  const loginOk = check(loginRes, {
    "login returns 200": (r) => r.status === 200,
    "login has accessToken": (r) => {
      try { return JSON.parse(r.body).accessToken !== undefined; }
      catch (err) { return false; }
    },
  });

  loginFailRate.add(!loginOk);
  loginDuration.add(loginRes.timings.duration);

  if (loginOk) {
    const { accessToken } = JSON.parse(loginRes.body);

    // Authenticated request
    const meRes = http.get(`${BASE_URL}/v1/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    check(meRes, {
      "me returns 200": (r) => r.status === 200,
    });
  }

  sleep(1);
}
