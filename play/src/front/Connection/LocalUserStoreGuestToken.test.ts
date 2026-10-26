import { beforeEach, describe, expect, it, vi } from "vitest";
import { localUserStore } from "./LocalUserStore";

vi.mock("../Enum/EnvironmentVariable.ts", () => {
    return {
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
        MAX_USERNAME_LENGTH: 10,
    };
});

/** A token as the pusher makes it: only the payload matters here. */
function token(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
    return `${encode({ alg: "HS256" })}.${encode(payload)}.signature`;
}

const GUEST = token({ identifier: "5b522f38-d7d2-4e37-be94-2476cb1efdfe" });
const ACCOUNT = token({ identifier: "elj@example.test", accessToken: "access" });

describe("LocalUserStore guest token kept aside for sign-in (#1430)", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("keeps a guest's token aside and hands it out once", () => {
        localUserStore.setAuthToken(GUEST);
        localUserStore.keepGuestTokenAside();
        localUserStore.setAuthToken(null);

        expect(localUserStore.takeGuestTokenAside()).toBe(GUEST);
        expect(localUserStore.takeGuestTokenAside()).toBeNull();
    });

    it("never keeps an account's token", () => {
        localUserStore.setAuthToken(ACCOUNT);
        localUserStore.keepGuestTokenAside();

        expect(localUserStore.takeGuestTokenAside()).toBeNull();
    });

    it("keeps nothing when the device holds no token", () => {
        localUserStore.keepGuestTokenAside();

        expect(localUserStore.takeGuestTokenAside()).toBeNull();
    });

    it("lets it go stale after 30 minutes, so it is not handed to the next person on a shared device", () => {
        localUserStore.setAuthToken(GUEST);
        const start = Date.now();
        localUserStore.keepGuestTokenAside(start);

        expect(localUserStore.takeGuestTokenAside(start + 31 * 60 * 1000)).toBeNull();
        // and asking removed it, fresh or not
        expect(localUserStore.takeGuestTokenAside(start)).toBeNull();
    });

    it("can be dropped (logout, a new guest)", () => {
        localUserStore.setAuthToken(GUEST);
        localUserStore.keepGuestTokenAside();
        localUserStore.dropGuestTokenAside();

        expect(localUserStore.takeGuestTokenAside()).toBeNull();
    });

    it("ignores a corrupted record", () => {
        localStorage.setItem("guestTokenAside", "{not json");

        expect(localUserStore.takeGuestTokenAside()).toBeNull();
    });
});
