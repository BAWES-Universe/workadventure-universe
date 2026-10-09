import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectPartner } from "../DirectPartnerStore";

const orbit = vi.hoisted(() => ({
    canOpenOrbit: vi.fn(() => true),
    openOrbitProfile: vi.fn(() => true),
    openOrbitProfileByChatId: vi.fn(() => true),
}));

vi.mock("../../../../../external-modules/admin-api/index", () => orbit);
vi.mock("../../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../../../../WebRtc/BlackListManager", () => ({ blackListManager: {} }));
vi.mock("../../../../../Stores/ShowReportScreenStore", () => ({ showReportScreenStore: {} }));
vi.mock("../../../UserList/PersonNavigation", () => ({
    goToPersonRoom: vi.fn(),
    locatePerson: vi.fn(),
    walkToPerson: vi.fn(),
}));

import { canOpenPartnerProfile, openPartnerProfile } from "../PartnerActions";

function partner(overrides: Partial<DirectPartner> = {}): DirectPartner {
    return {
        chatId: "@ada:chat.example.com",
        user: undefined,
        place: { kind: "away" } as unknown as DirectPartner["place"],
        actions: { walkTo: false, locate: false },
        isBot: false,
        isBlocked: false,
        ...overrides,
    };
}

describe("a direct chat's View profile", () => {
    beforeEach(() => {
        orbit.canOpenOrbit.mockReturnValue(true);
        orbit.openOrbitProfile.mockClear();
        orbit.openOrbitProfileByChatId.mockClear();
    });

    it("opens their Orbit profile by account id when they're in Universe", () => {
        const here = partner({ user: { uuid: "uuid-ada" } as DirectPartner["user"] });
        expect(canOpenPartnerProfile(here)).toBe(true);
        openPartnerProfile(here);
        expect(orbit.openOrbitProfile).toHaveBeenCalledWith("uuid-ada");
        expect(orbit.openOrbitProfileByChatId).not.toHaveBeenCalled();
    });

    it("opens it by Matrix id when they're away, so offline people work too", () => {
        const away = partner();
        expect(canOpenPartnerProfile(away)).toBe(true);
        openPartnerProfile(away);
        expect(orbit.openOrbitProfileByChatId).toHaveBeenCalledWith("@ada:chat.example.com");
        expect(orbit.openOrbitProfile).not.toHaveBeenCalled();
    });

    it("never opens one for a bot, online or not", () => {
        const onlineBot = partner({ isBot: true, user: { uuid: "bot-1" } as DirectPartner["user"] });
        const awayBot = partner({ chatId: "@bot_helper:chat.example.com" });
        for (const bot of [onlineBot, awayBot]) {
            expect(canOpenPartnerProfile(bot)).toBe(false);
            openPartnerProfile(bot);
        }
        expect(orbit.openOrbitProfile).not.toHaveBeenCalled();
        expect(orbit.openOrbitProfileByChatId).not.toHaveBeenCalled();
    });

    it("has nothing to open without Orbit or without any id for them", () => {
        orbit.canOpenOrbit.mockReturnValue(false);
        expect(canOpenPartnerProfile(partner())).toBe(false);
        orbit.canOpenOrbit.mockReturnValue(true);
        expect(canOpenPartnerProfile(partner({ chatId: undefined }))).toBe(false);
    });
});
