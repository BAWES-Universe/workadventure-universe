/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts?$': 'ts-jest',
  },
  transformIgnorePatterns: ['<rootDir>/node_modules/'],
  roots: ['./ai'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@workadventure/messages(.*)$': '<rootDir>/../libs/messages/src$1',
  },
};