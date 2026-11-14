import { describe, expect, it } from "vitest";
import { classifyCallFailure } from "./callFailure";

describe("classifyCallFailure", () => {
    it.each([
        [{ status: 403, code: "not_allowed" }, "not_allowed"],
        [{ status: 403 }, "not_allowed"],
        [{ status: 503, code: "cannot_check" }, "cannot_check"],
        [{ status: 409, code: "no_voice" }, "no_voice"],
        [{ status: 404, code: "not_here" }, "not_here"],
        [{ status: 404 }, "not_here"],
        [{ status: 401, code: "session_expired" }, "sign_in"],
        [{ status: 403, code: "not_you" }, "sign_in"],
        [{ isAuthError: true }, "sign_in"],
        [{ status: 500, code: "failed" }, "failed"],
        [new Error("network"), "failed"],
        [undefined, "failed"],
    ])("%j is %s", (error, expected) => {
        expect(classifyCallFailure(error)).toBe(expected);
    });
});
