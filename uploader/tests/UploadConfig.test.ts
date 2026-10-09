import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

// The settings are read once when the module loads, so each case loads a fresh copy with its own environment.
function loadSettings(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  delete process.env.ENABLE_CHAT_UPLOAD;
  delete process.env.UPLOAD_MAX_FILESIZE;
  Object.entries(env).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
  let settings!: typeof import("../src/Enum/EnvironmentVariable");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    settings = require("../src/Enum/EnvironmentVariable");
  });
  process.env = saved;
  return settings;
}

describe("upload settings", () => {
  beforeAll(() => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("chat uploads switch", () => {
    it.each([
      ["unset", undefined],
      ["empty", ""],
      ["true", "true"],
      ["1", "1"],
    ])("stays on when it is %s", (_name, value) => {
      expect(loadSettings({ ENABLE_CHAT_UPLOAD: value }).ENABLE_CHAT_UPLOAD).toBe(true);
    });

    it.each(["false", "FALSE", "0", "off", " false "])("turns off for the text %j", (value) => {
      expect(loadSettings({ ENABLE_CHAT_UPLOAD: value }).ENABLE_CHAT_UPLOAD).toBe(false);
    });
  });

  describe("file size limit", () => {
    it("keeps a configured limit", () => {
      expect(loadSettings({ UPLOAD_MAX_FILESIZE: "2048" }).UPLOAD_MAX_FILESIZE).toBe("2048");
    });

    it.each([
      ["unset", undefined],
      ["empty", ""],
      ["zero", "0"],
      ["negative", "-5"],
      ["not a number", "ten"],
      ["infinite", "Infinity"],
    ])("falls back to 10 MB when it is %s, so there is always a limit", (_name, value) => {
      expect(loadSettings({ UPLOAD_MAX_FILESIZE: value }).UPLOAD_MAX_FILESIZE).toBe("10485760");
    });
  });
});
