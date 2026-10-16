import Jwt from "jsonwebtoken";
import { describe, expect, it } from "@jest/globals";
import { isValidPlayAuthToken, isValidPlayGameSession } from "../src/Service/PlayAuthToken";

const SECRET = "test-secret-key";

describe("isValidPlayAuthToken", () => {
  it("accepts a signed-in player's token", () => {
    const token = Jwt.sign(
      { identifier: "user@example.com", accessToken: "oidc-access-token" },
      SECRET,
      { expiresIn: "30d" }
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(true);
  });

  it("rejects a guest's token (no sign-in)", () => {
    const token = Jwt.sign(
      { identifier: "3f1c2b8e-guest-uuid", tags: [] },
      SECRET,
      { expiresIn: "30d" }
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects an empty access token", () => {
    const token = Jwt.sign(
      { identifier: "user@example.com", accessToken: "" },
      SECRET
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects a missing token", () => {
    expect(isValidPlayAuthToken(undefined, SECRET)).toBe(false);
    expect(isValidPlayAuthToken("", SECRET)).toBe(false);
  });

  it("rejects a token signed with another key", () => {
    const token = Jwt.sign(
      { identifier: "user@example.com", accessToken: "oidc-access-token" },
      "another-key"
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects an expired token", () => {
    const token = Jwt.sign(
      {
        identifier: "user@example.com",
        accessToken: "oidc-access-token",
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      SECRET
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects an unsigned token", () => {
    const token = Jwt.sign(
      { identifier: "user@example.com", accessToken: "oidc-access-token" },
      "",
      { algorithm: "none" }
    );
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects a token without identifier", () => {
    const token = Jwt.sign({ accessToken: "oidc-access-token" }, SECRET);
    expect(isValidPlayAuthToken(token, SECRET)).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isValidPlayAuthToken("not-a-jwt", SECRET)).toBe(false);
  });
});

describe("isValidPlayGameSession", () => {
  it("accepts a signed-in player and a guest", () => {
    const signedIn = Jwt.sign({ identifier: "user@example.com", accessToken: "oidc" }, SECRET);
    const guest = Jwt.sign({ identifier: "3f1c2b8e-guest-uuid" }, SECRET);
    expect(isValidPlayGameSession(signedIn, SECRET)).toBe(true);
    expect(isValidPlayGameSession(guest, SECRET)).toBe(true);
  });

  it("rejects a missing, forged, expired or identifier-less token", () => {
    expect(isValidPlayGameSession(undefined, SECRET)).toBe(false);
    expect(isValidPlayGameSession("", SECRET)).toBe(false);
    expect(isValidPlayGameSession("hello", SECRET)).toBe(false);
    expect(isValidPlayGameSession(Jwt.sign({ identifier: "x" }, "another-key"), SECRET)).toBe(false);
    expect(isValidPlayGameSession(Jwt.sign({ identifier: "x" }, SECRET, { expiresIn: -10 }), SECRET)).toBe(false);
    expect(isValidPlayGameSession(Jwt.sign({ accessToken: "oidc" }, SECRET), SECRET)).toBe(false);
    expect(isValidPlayGameSession(Jwt.sign({ identifier: "" }, SECRET), SECRET)).toBe(false);
  });
});
