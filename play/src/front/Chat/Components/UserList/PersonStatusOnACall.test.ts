import { AvailabilityStatus } from "@workadventure/messages";
import { beforeAll, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import { loadLocale } from "../../../../i18n/i18n-util.sync";
import LL, { setLocale } from "../../../../i18n/i18n-svelte";
import { statusLabelOnACall } from "./PersonStatus";

describe("the status words with 'On a call' (game #2004)", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    it("says only the status when there is no call", () => {
        expect(statusLabelOnACall(AvailabilityStatus.ONLINE, false, get(LL))).toBe("Online");
        expect(statusLabelOnACall(AvailabilityStatus.BUSY, undefined, get(LL))).toBe("Busy");
    });

    it("says 'On a call' for someone Online, and keeps Busy and Do not disturb as they are", () => {
        expect(statusLabelOnACall(AvailabilityStatus.ONLINE, true, get(LL))).toBe("On a call");
        expect(statusLabelOnACall(AvailabilityStatus.BUSY, true, get(LL))).toBe("Busy · On a call");
        expect(statusLabelOnACall(AvailabilityStatus.DO_NOT_DISTURB, true, get(LL))).toContain("Do not disturb");
        expect(statusLabelOnACall(AvailabilityStatus.DO_NOT_DISTURB, true, get(LL))).toContain("On a call");
    });
});
