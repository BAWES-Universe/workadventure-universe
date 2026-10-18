import { describe, expect, it, vi } from "vitest";
import { AvailabilityStatus } from "@workadventure/messages";
import { sayTypeForcedByStatus } from "../sendSay";

vi.mock("../../GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));

describe("sayTypeForcedByStatus", () => {
    it("lets the player choose in a silent zone: it stops calls, and a bubble starts none", () => {
        expect(sayTypeForcedByStatus(AvailabilityStatus.SILENT)).toBeUndefined();
    });

    it("keeps Think in a silent zone when the player picked Busy, Back in a moment or Do not disturb", () => {
        expect(sayTypeForcedByStatus(AvailabilityStatus.SILENT, AvailabilityStatus.BUSY)).toBe("think");
        expect(sayTypeForcedByStatus(AvailabilityStatus.SILENT, AvailabilityStatus.BACK_IN_A_MOMENT)).toBe("think");
        expect(sayTypeForcedByStatus(AvailabilityStatus.SILENT, AvailabilityStatus.DO_NOT_DISTURB)).toBe("think");
        expect(sayTypeForcedByStatus(AvailabilityStatus.SILENT, null)).toBeUndefined();
    });

    it("still forces Think while away or busy", () => {
        expect(sayTypeForcedByStatus(AvailabilityStatus.BUSY)).toBe("think");
        expect(sayTypeForcedByStatus(AvailabilityStatus.AWAY)).toBe("think");
        expect(sayTypeForcedByStatus(AvailabilityStatus.DO_NOT_DISTURB)).toBe("think");
    });

    it("still forces Say in a meeting", () => {
        expect(sayTypeForcedByStatus(AvailabilityStatus.LIVEKIT)).toBe("say");
    });

    it("lets the player choose when online", () => {
        expect(sayTypeForcedByStatus(AvailabilityStatus.ONLINE)).toBeUndefined();
    });
});
