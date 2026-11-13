import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CarrySteps } from "../GuestBrickCarry";
import { newGuestChat, serializeGuestChat, withLine } from "../GuestBrick";

const GUEST = "6f1c2d3e-1111-4222-8333-444455556666";

const shared = vi.hoisted(() => ({
    saved: null as string | null,
    taken: null as string | null,
    writeFails: false,
    steps: undefined as undefined | CarrySteps,
}));

vi.mock("../../../Connection/LocalUserStore", () => ({
    GUEST_TOKEN_ASIDE_MS: 1000,
    localUserStore: {
        getChatId: () => "@me:chat",
        guestId: () => GUEST,
        getGuestBrickChat: () => shared.saved,
        setGuestBrickChat: (raw: string) => {
            if (!shared.writeFails) shared.saved = raw;
        },
        getGuestBrickChatTaken: () => shared.taken,
        setGuestBrickChatTaken: (id: string) => {
            shared.taken = id;
        },
        dropGuestBrickChat: () => {
            shared.saved = null;
            shared.taken = null;
        },
    },
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: {} }));
vi.mock("../../../../i18n/i18n-svelte", () => ({ LL: writable({}) }));
vi.mock("../../../Stores/MenuStore", () => ({ userIsConnected: writable(true) }));
vi.mock("../../Stores/ChatStore", () => ({ chatSearchBarValue: writable("") }));
vi.mock("../../Utils", () => ({ showRoom: vi.fn() }));
vi.mock("../../Components/OneList/OneListStore", () => ({ brickEntry: vi.fn() }));
vi.mock("../GuestBrickChatRoom", () => ({ GuestBrickChatRoom: class {} }));
vi.mock("../MyBricksStore", () => ({ myBricksStore: writable([{ id: "10", isDefault: true }]) }));
vi.mock("../GuestBrickCarry", () => ({
    bringGuestChat: (steps: CarrySteps) => {
        shared.steps = steps;
        return Promise.resolve("later");
    },
}));

describe("the chat a guest brought along keeps that Orbit handed it over, even when it cannot be saved again (#1997)", () => {
    beforeEach(() => {
        shared.writeFails = false;
        shared.taken = null;
        shared.saved = serializeGuestChat(withLine(newGuestChat(GUEST, 1), { from: "guest", text: "hi", at: 2 }));
        shared.steps = undefined;
    });

    async function steps(): Promise<CarrySteps> {
        // A fresh page each time: what a page remembers is its own
        vi.resetModules();
        const { bringGuestChatInto } = await import("../GuestBrickStore");
        bringGuestChatInto("10");
        return shared.steps as CarrySteps;
    }

    it("reads a chat as taken once its mark was kept, though the chat itself could not be saved with it", async () => {
        const carry = await steps();
        const chat = carry.read();
        expect(chat?.carryTaken).toBeUndefined();

        shared.writeFails = true;
        carry.keep({ ...(chat as NonNullable<typeof chat>), carryTaken: true });

        // The chat on the device has no mark, but the one handed over is still known, so Orbit is not asked again
        expect(JSON.parse(shared.saved as string).carryTaken).toBeUndefined();
        expect(carry.read()?.carryTaken).toBe(true);
    });

    it("does not take a chat as handed over when the mark, or the chat itself, was left by another account on this device", async () => {
        const carry = await steps();
        shared.taken = `${GUEST}|@someone-else:chat`;
        expect(carry.read()?.carryTaken).toBeUndefined();

        const chat = JSON.parse(shared.saved as string);
        shared.saved = JSON.stringify({ ...chat, carryTaken: true });
        expect(carry.read()?.carryTaken).toBeUndefined();

        shared.taken = `${GUEST}|@me:chat`;
        expect(carry.read()?.carryTaken).toBe(true);
    });

    it("lets go of the mark with the chat", async () => {
        const carry = await steps();
        carry.keep({ ...(carry.read() as NonNullable<ReturnType<CarrySteps["read"]>>), carryTaken: true });
        carry.drop();
        expect(shared.taken).toBeNull();
        expect(shared.saved).toBeNull();
    });
});
