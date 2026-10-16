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
const blackList = vi.hoisted(() => ({ isBlackListed: vi.fn(() => false) }));
vi.mock("../../../../../WebRtc/BlackListManager", () => ({ blackListManager: blackList }));
vi.mock("../../../../../Stores/ShowReportScreenStore", () => ({ showReportScreenStore: {} }));
const ring = vi.hoisted(() => ({ ring: vi.fn(() => Promise.resolve(true)) }));
vi.mock("../../../../Stores/RingStore", () => ({ ringStore: ring }));
const friendMenu = vi.hoisted(() => ({ friendMenuAction: vi.fn(() => ({ label: "Add friend" })) }));
vi.mock("../../../UserList/FriendMenuAction", () => friendMenu);
vi.mock("../../../UserList/PersonNavigation", () => ({
    goToPersonRoom: vi.fn(),
    locatePerson: vi.fn(),
    walkToPerson: vi.fn(),
}));

import type { TranslationFunctions } from "../../../../../../i18n/i18n-types";
import {
    canInvitePartner,
    canOpenPartnerProfile,
    canReportPartner,
    invitePartner,
    openPartnerProfile,
    partnerFriendAction,
} from "../PartnerActions";

function partner(overrides: Partial<DirectPartner> = {}): DirectPartner {
    return {
        chatId: "@ada:chat.example.com",
        user: undefined,
        uuid: undefined,
        place: { kind: "away" } as unknown as DirectPartner["place"],
        actions: { walkTo: false, locate: false },
        isBot: false,
        isBlocked: false,
        isGameBlocked: false,
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

describe("a direct chat's Invite, Add friend and Report", () => {
    const ll = {} as TranslationFunctions;

    it("invites anyone with an account who is online in Universe or on chat, never offline ones", () => {
        const away = partner({ uuid: "uuid-ada", place: { kind: "elsewhere" } });
        expect(canInvitePartner(away, true)).toBe(true);
        expect(canInvitePartner(partner({ uuid: "uuid-ada", place: { kind: "chatOnly" } }), true)).toBe(true);
        expect(canInvitePartner(partner({ uuid: "uuid-ada", place: { kind: "offline" } }), true)).toBe(false);
    });

    it("needs their account id, invites turned on, and no bot or blocked person", () => {
        const online = { place: { kind: "chatOnly" } } as const;
        expect(canInvitePartner(partner({ ...online }), true)).toBe(false);
        expect(canInvitePartner(partner({ ...online, uuid: "uuid-ada" }), false)).toBe(false);
        expect(canInvitePartner(partner({ ...online, uuid: "uuid-ada", isBlocked: true }), true)).toBe(false);
        expect(canInvitePartner(partner({ ...online, uuid: "uuid-ada", isGameBlocked: true }), true)).toBe(false);
        expect(canInvitePartner(partner({ ...online, uuid: "uuid-bot", isBot: true }), true)).toBe(false);
        expect(canInvitePartner(partner({ ...online, uuid: "uuid-bot", chatId: "@bot_helper:chat" }), true)).toBe(
            false
        );
    });

    it("rings them by account id", () => {
        invitePartner(partner({ uuid: "uuid-ada" }), "Ada");
        expect(ring.ring).toHaveBeenCalledWith("uuid-ada", "Ada");
        ring.ring.mockClear();
        invitePartner(partner(), "Ada");
        expect(ring.ring).not.toHaveBeenCalled();
    });

    it("does not ring someone blocked in the game from the Moderation menu", () => {
        ring.ring.mockClear();
        // The partner followed the block list.
        invitePartner(partner({ uuid: "uuid-ada", isGameBlocked: true }), "Ada");
        // The partner has not caught up with a block that was just made.
        blackList.isBlackListed.mockReturnValueOnce(true);
        invitePartner(partner({ uuid: "uuid-ada" }), "Ada");

        expect(blackList.isBlackListed).toHaveBeenCalledWith("uuid-ada");
        expect(ring.ring).not.toHaveBeenCalled();
    });

    it("offers Add friend from how you stand with them, and nothing without friends, an account or a chat id", () => {
        const relationships = new Map([["uuid-ada", "request_sent" as const]]);
        const ada = partner({ uuid: "uuid-ada" });
        expect(partnerFriendAction(ada, "Ada", true, relationships, ll)).toBeDefined();
        expect(friendMenu.friendMenuAction).toHaveBeenLastCalledWith("request_sent", "uuid-ada", "Ada", ll);
        partnerFriendAction(partner({ uuid: "uuid-bob" }), "Bob", true, relationships, ll);
        expect(friendMenu.friendMenuAction).toHaveBeenLastCalledWith("none", "uuid-bob", "Bob", ll);

        expect(partnerFriendAction(ada, "Ada", false, relationships, ll)).toBeUndefined();
        expect(partnerFriendAction(partner(), "Ada", true, relationships, ll)).toBeUndefined();
        expect(partnerFriendAction(partner({ uuid: "u", chatId: undefined }), "Ada", true, relationships, ll)).toBe(
            undefined
        );
        expect(partnerFriendAction(partner({ uuid: "u", isBot: true }), "Ada", true, relationships, ll)).toBe(
            undefined
        );
    });

    it("reports them by the account id found for an away person too", () => {
        expect(canReportPartner(partner({ uuid: "uuid-ada" }))).toBe(true);
        expect(canReportPartner(partner())).toBe(false);
        expect(canReportPartner(partner({ uuid: "uuid-bot", isBot: true }))).toBe(false);
    });
});
