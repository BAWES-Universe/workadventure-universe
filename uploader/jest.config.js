/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    // FileController.ts mixes the express types of this package with multer's (two copies of @types/express-serve-static-core
    // in the workspace), which only shows once a test imports it. The server itself is built without that check.
    '^.+\\.ts?$': ['ts-jest', { diagnostics: { exclude: ['**/src/Controller/FileController.ts'] } }],
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/'],
  roots: [
    "./tests"
  ],
  globalSetup: "<rootDir>/tests/globalTestSetup.ts"
};
