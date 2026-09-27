import { MatrixError } from "matrix-js-sdk";

/**
 * Whether a failed join means the invite can never be accepted: the server answered with a definitive
 * refusal (forbidden, or no server left in the room to join through) rather than a network or server error.
 */
export function isInvitationGoneError(error: unknown): boolean {
    if (!(error instanceof MatrixError)) return false;
    if (error.errcode === "M_FORBIDDEN" || error.errcode === "M_NOT_FOUND") return true;
    return error.httpStatus === 403 || error.httpStatus === 404;
}
