/**
 * Unit tests for the GET /logout query parameter validation.
 *
 * Regression test for: JsonWebTokenError: jwt must be provided
 * Root cause: the token field accepted empty strings, which were passed to
 * jwt.verify("", SECRET) causing it to throw. The fix tightened the Zod
 * schema to z.string().min(1) so empty tokens are rejected with HTTP 400
 * before reaching JWT verification.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror the exact schema used in AuthenticateController GET /logout
const logoutQuerySchema = z.object({
    playUri: z.string(),
    token: z.string().min(1),
    redirect: z.string().optional(),
});

describe("GET /logout token validation schema", () => {
    it("should reject an empty token string", () => {
        const result = logoutQuerySchema.safeParse({
            playUri: "https://play.example.com/room",
            token: "",
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            const tokenError = result.error.issues.find((i) => i.path.includes("token"));
            expect(tokenError).toBeDefined();
        }
    });

    it("should reject a missing token field", () => {
        const result = logoutQuerySchema.safeParse({
            playUri: "https://play.example.com/room",
        });
        expect(result.success).toBe(false);
    });

    it("should accept a valid non-empty token", () => {
        const result = logoutQuerySchema.safeParse({
            playUri: "https://play.example.com/room",
            token: "header.payload.signature",
        });
        expect(result.success).toBe(true);
    });

    it("should accept a valid token with optional redirect", () => {
        const result = logoutQuerySchema.safeParse({
            playUri: "https://play.example.com/room",
            token: "header.payload.signature",
            redirect: "https://example.com",
        });
        expect(result.success).toBe(true);
    });
});
