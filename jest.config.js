module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/test-results/"],
  modulePathIgnorePatterns: ["<rootDir>/.worktrees/", "<rootDir>/test-results/"],
};
