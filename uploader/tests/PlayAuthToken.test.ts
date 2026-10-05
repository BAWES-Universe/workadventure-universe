import Jwt from "jsonwebtoken";
import { describe, expect, it } from "@jest/globals";
import { isValidPlayAuthToken } from "../src/Service/PlayAuthToken";

const SECRET = "test-secret-key";

describe("isValidPlayAuthToken", () => {
  it("accepts a token signed by play", () => {
    const token = Jwt.sign({ identifier: "user@example.com" }, SECRET, {
      expiresIn: "30d",
    });
    expect(isValidPlayAuthToken(token, SECRET)).toBe(true);
  });

  it("rejects a missing token", () => {
    expect(isValidPlayAuthToken(undefined, SECRET)).toBe(false);
    expect(isValidPlayAuthToken("", SECRET)).toBe(false);
  });

  it("rejects a token signed with another key", () => {
    const token = Jwt.sign({ identifier: "user@example.com" }, "another-key");
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = Jwt.sign(
      {
        identifier: "user@example.com",
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      SECRET
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects an unsigned token", () => {
    const token = Jwt.sign({ identifier: "user@example.com" }, "", {
      algorithm: "none",
    });
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects a token without identifier", () => {
    const token = Jwt.sign({ foo: "bar" }, SECRET);
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidPlayAuthToken("not-a-jwt", SECRET)).toBe(false);
  });
});
