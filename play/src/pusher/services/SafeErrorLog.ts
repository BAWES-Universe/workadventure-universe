import axios from "axios";

/**
 * What may go to the logs and the error tracker about a failure. An error thrown by axios carries the whole request
 * (its Authorization header, with the admin token, and the cookies) and the response, and an error about a rejected
 * token must not repeat the token. Only what failed is kept: the message, the error code and the HTTP status.
 */
export function describeError(e: unknown): string {
    if (axios.isAxiosError(e)) {
        const details = [e.code, e.response?.status && `HTTP ${e.response.status}`].filter(Boolean).join(", ");
        return `${e.message}${details ? ` (${details})` : ""}`;
    }
    return e instanceof Error ? e.message : String(e);
}
