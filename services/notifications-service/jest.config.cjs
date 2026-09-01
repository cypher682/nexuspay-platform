/** @type {import("jest").Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts", "!src/workers/index.ts"],
  coverageDirectory: "coverage",
  clearMocks: true
};
