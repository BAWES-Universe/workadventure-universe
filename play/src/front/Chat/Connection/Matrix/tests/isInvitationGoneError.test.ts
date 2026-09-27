import { describe, expect, it } from "vitest";
import { MatrixError } from "matrix-js-sdk";
import { isInvitationGoneError } from "../isInvitationGoneError";

describe("isInvitationGoneError", () => {
    it("treats a forbidden join as a dead invitation", () => {
        expect(isInvitationGoneError(new MatrixError({ errcode: "M_FORBIDDEN", error: "not invited" }, 403))).toBe(
            true
        );
    });

    it("treats a room with no server left to join through as a dead invitation", () => {
        expect(isInvitationGoneError(new MatrixError({ errcode: "M_UNKNOWN", error: "No known servers" }, 404))).toBe(
            true
        );
    });

    it("keeps the invitation on a server or network error", () => {
        expect(isInvitationGoneError(new MatrixError({ errcode: "M_UNKNOWN", error: "oops" }, 502))).toBe(false);
        expect(isInvitationGoneError(new Error("Failed to fetch"))).toBe(false);
    });
});
