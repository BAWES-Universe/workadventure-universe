import { describe, expect, it } from "vitest";
import { classifySummonFailure, summonFailureLine } from "./summonFailure";

describe("classifySummonFailure", () => {
    it.each([
        [{ status: 409, code: "cannot_see_you" }, "cannot_see_you"],
        [{ status: 409, code: "busy" }, "busy"],
        [{ status: 409, code: "already_with_you" }, "already_with_you"],
        [{ status: 404, code: "not_here" }, "not_here"],
        [{ status: 404 }, "not_here"],
        // An answer without a code (an older bot server) still gets the right line.
        [{ status: 409 }, "cannot_see_you"],
        [{ status: 401 }, "sign_in"],
        [{ status: 403, code: "not_you" }, "sign_in"],
        [{ isAuthError: true }, "sign_in"],
        [{ status: 500, code: "failed" }, "failed"],
        [{ status: 502 }, "failed"],
        [new TypeError("Failed to fetch"), "failed"],
        [undefined, "failed"],
        ["boom", "failed"],
    ])("%j is %s", (error, expected) => {
        expect(classifySummonFailure(error)).toBe(expected);
    });
});

describe("summonFailureLine", () => {
    it.each([
        ["cannot_see_you", "cannotSeeYou"],
        ["not_here", "notHere"],
        ["busy", "busy"],
        ["already_with_you", "withYou"],
        ["failed", "failed"],
    ] as const)("%s shows %s", (failure, line) => {
        expect(summonFailureLine(failure, true)).toBe(line);
        expect(summonFailureLine(failure, false)).toBe(line);
    });

    it("asks a signed-in player to sign in again", () => {
        expect(summonFailureLine("sign_in", true)).toBe("signIn");
    });

    it("does not send a guest to a sign-in they do not have", () => {
        expect(summonFailureLine("sign_in", false)).toBe("failed");
    });
});

describe("the owner's limits", () => {
    it("are told apart from a sign-in problem, although the bot server answers 403", () => {
        expect(classifySummonFailure({ status: 403, code: "not_allowed" })).toBe("not_allowed");
        expect(classifySummonFailure({ status: 503, code: "cannot_check" })).toBe("cannot_check");
    });
});
