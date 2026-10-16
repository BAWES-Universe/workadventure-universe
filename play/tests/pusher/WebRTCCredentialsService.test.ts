import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    TURN_STATIC_AUTH_SECRET: "SomeStaticAuthSecret",
}));

import { webRTCCredentialsService } from "../../src/pusher/services/WebRTCCredentialsService";

const HOUR_MS = 3600 * 1000;
// The front's default renewal interval: a peer can be created with credentials obtained that long ago.
const DEFAULT_RENEWAL_MS = HOUR_MS;

/** Coturn's use-auth-secret username is "<expiry unix timestamp>:<user>". */
function expiryOf(username: string): number {
    return Number(username.split(":")[0]) * 1000;
}

describe("WebRTCCredentialsService", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("hands out TURN credentials that outlive a long call started just before the next renewal", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-10T08:00:00Z"));

        const { webRtcUserName } = webRTCCredentialsService.generateCredentials("user-a");

        // Coturn checks the expiry on every allocation Refresh (every few minutes), not just when the call starts:
        // once it passes, a relayed call that is still running loses its allocation and drops. A peer created right
        // before the next renewal uses these credentials, and a working day of calls must still fit after that.
        const callStart = Date.now() + DEFAULT_RENEWAL_MS;
        expect(expiryOf(webRtcUserName)).toBeGreaterThanOrEqual(callStart + 8 * HOUR_MS);
    });
});
