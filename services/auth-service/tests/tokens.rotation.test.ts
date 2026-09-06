import jwt from "jsonwebtoken";

const oldSecret = "old-secret-value-at-least-thirty-two-characters-long";
const newSecret = "new-secret-value-at-least-thirty-two-characters-long!";

function mint(payload: Record<string, unknown>, secret: string): string {
  return jwt.sign({ ...payload, iss: "NexusPay" }, secret, { algorithm: "HS256" });
}

describe("jwt key rotation (OLD_JWT_SECRETS)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  // The env module parses its secrets once at import time, so we stub it with a
  // controlled JWT_SECRET + OLD_JWT_SECRETS and (re)import tokens per case.
  async function loadTokens(jwtSecret: string, oldJwtSecrets: string) {
    jest.doMock("../src/config/env", () => ({
      env: {
        JWT_SECRET: jwtSecret,
        OLD_JWT_SECRETS: oldJwtSecrets,
        JWT_ALGORITHM: "HS256",
        ACCESS_TOKEN_TTL_MINUTES: 15,
        MFA_ISSUER: "NexusPay"
      }
    }));
    return import("../src/lib/tokens");
  }

  it("accepts a token signed with the NEW current secret", async () => {
    const { createAccessToken, decodeToken } = await loadTokens(newSecret, oldSecret);
    const token = createAccessToken("user-1", ["payments:write"], "u@x.io");
    expect(decodeToken(token).sub).toBe("user-1");
  });

  it("accepts a token signed with an OLD secret during the grace window", async () => {
    const { decodeToken } = await loadTokens(newSecret, oldSecret);
    const token = mint({ sub: "user-1", type: "access", email: "u@x.io", scopes: [] }, oldSecret);
    expect(decodeToken(token).sub).toBe("user-1");
  });

  it("rejects a token that matches no configured key", async () => {
    const { decodeToken } = await loadTokens(newSecret, oldSecret);
    const token = mint(
      { sub: "user-1", type: "access", scopes: [] },
      "totally-different-secret-that-is-not-in-config-anywhere-long"
    );
    expect(() => decodeToken(token)).toThrow();
  });
});
