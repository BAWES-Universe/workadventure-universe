import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";

// A reconnect is swapping the map: there is no game scene to read.
vi.mock("../../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => {
            throw new Error("Not the Game Scene");
        },
        tryGetCurrentGameScene: () => undefined,
    },
}));
vi.mock("../../../../Stores/ChatStore", () => ({
    chatSearchBarValue: writable(""),
    navChat: { switchToUserList: vi.fn() },
}));
vi.mock("../../../../Stores/SelectRoomStore", () => ({ selectedRoomStore: writable(undefined) }));
vi.mock("../../../UserList/PersonNavigation", () => ({ goToPersonRoom: vi.fn(), walkToPerson: vi.fn() }));
vi.mock("../../../../../Administration/AnalyticsClient", () => ({
    analyticsClient: new Proxy({}, { get: () => () => {} }),
}));
vi.mock("../../../../../../i18n/i18n-svelte", () => {
    const fn: unknown = new Proxy(() => "x", { get: () => fn, apply: () => "x" });
    return { default: readable(fn), LL: readable(fn) };
});

import type { ProximitySession } from "../../../../Connection/Proximity/ProximitySessions";
import type { ChatMessage } from "../../../../Connection/ChatConnection";
import ProximityEndedFooter from "../ProximityEndedFooter.svelte";

const endedWithBot: ProximitySession<ChatMessage> = {
    id: "stay-1",
    stayIds: ["stay-1"],
    index: 1,
    label: "Bot",
    participants: ["Bot"],
    participantIds: ["space-bot"],
    isArea: false,
    startedAt: 1,
    endedAt: 2,
    entries: [],
    messages: [],
    lastMessage: undefined,
    unsentDraft: undefined,
    isLive: false,
};

describe("ProximityEndedFooter", () => {
    let component: ProximityEndedFooter | undefined;

    afterEach(() => {
        component?.$destroy();
        document.body.innerHTML = "";
    });

    it("shows while the map is being swapped, instead of breaking the chat", async () => {
        const target = document.createElement("div");
        document.body.append(target);

        component = new ProximityEndedFooter({ target, props: { session: endedWithBot } });
        await tick();

        expect(target.innerHTML).not.toBe("");
    });
});
