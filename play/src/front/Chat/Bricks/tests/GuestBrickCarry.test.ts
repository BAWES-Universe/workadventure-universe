import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_WAIT_MS } from "../Brick";
import { newGuestChat, withLine, type GuestChat } from "../GuestBrick";
import { bringGuestChat, carryGuestChatAlong, guestChatCarrying, type CarrySteps } from "../GuestBrickCarry";

const GUEST = "4f1d2c3b-aaaa-4bbb-8ccc-0123456789ab";

function chatWithWords(over: Partial<GuestChat> = {}): GuestChat {
    let chat = newGuestChat(GUEST, 1);
    chat = withLine(chat, { from: "guest", text: "Remember I take it without sugar", at: 2 });
    chat = withLine(chat, { from: "brick", text: "I can only remember once I'm yours.", at: 3, needsAccount: true });
    return { ...chat, ...over };
}

/** A device after sign-in: the chat it kept as a guest, and what Orbit and the bot server say to it. */
function device(initial: GuestChat | null = chatWithWords()) {
    const state: { chat: GuestChat | undefined; clock: number } = { chat: initial ?? undefined, clock: 0 };
    const steps: CarrySteps & { calls: string[] } = {
        calls: [],
        read: () => state.chat,
        keep: (chat) => {
            state.chat = chat;
            steps.calls.push("keep");
        },
        drop: () => {
            state.chat = undefined;
            steps.calls.push("drop");
        },
        take: vi.fn<CarrySteps["take"]>().mockResolvedValue(true),
        carry: vi.fn<CarrySteps["carry"]>().mockResolvedValue("sent"),
        sleep: (ms) => {
            state.clock += ms;
            return Promise.resolve();
        },
        now: () => state.clock,
    };
    return { state, steps };
}

describe("a guest signs in, and their chat comes with them (#1997)", () => {
    beforeEach(() => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    it("asks Orbit for the chat under the guest id the device held, then has the Brick say the lines as they were said", async () => {
        const { state, steps } = device();
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(steps.take).toHaveBeenCalledWith(GUEST);
        expect(steps.carry).toHaveBeenCalledWith(GUEST, [
            { from: "guest", text: "Remember I take it without sugar", at: 2 },
            { from: "brick", text: "I can only remember once I'm yours.", at: 3 },
        ]);
        // Said once: what the device kept goes, so it is never said again
        expect(state.chat).toBeUndefined();
    });

    it("has nothing to bring for someone who never talked to it as a guest, and asks nobody", async () => {
        const { steps } = device(null);
        await expect(carryGuestChatAlong(steps)).resolves.toBe("none");
        expect(steps.take).not.toHaveBeenCalled();
        expect(steps.carry).not.toHaveBeenCalled();
    });

    it("brings nothing, and lets the chat go, when Orbit did not hand it to this account", async () => {
        const { state, steps } = device();
        vi.mocked(steps.take).mockResolvedValue(false);
        await expect(carryGuestChatAlong(steps)).resolves.toBe("none");
        expect(steps.carry).not.toHaveBeenCalled();
        expect(state.chat).toBeUndefined();
    });

    it("tries again the next time when Orbit could not be asked, and keeps the chat for it", async () => {
        const { state, steps } = device();
        vi.mocked(steps.take).mockRejectedValue(new Error("offline"));
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        expect(state.chat).toBeDefined();
        expect(steps.carry).not.toHaveBeenCalled();
    });

    it("never asks Orbit for the same chat twice: once handed over, it is only brought", async () => {
        const { state, steps } = device();
        vi.mocked(steps.carry).mockRejectedValue(new Error("offline"));
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        expect(state.chat?.carryTaken).toBe(true);
        vi.mocked(steps.carry).mockResolvedValue("sent");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(steps.take).toHaveBeenCalledTimes(1);
        expect(state.chat).toBeUndefined();
    });

    it("waits for their chat with the Brick to exist, and asks again in a moment", async () => {
        const { steps } = device();
        vi.mocked(steps.carry).mockResolvedValueOnce("wait").mockResolvedValueOnce("wait").mockResolvedValue("sent");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(steps.carry).toHaveBeenCalledTimes(3);
    });

    it("stops waiting after a while, and goes on the next time the chat opens", async () => {
        const { state, steps } = device();
        vi.mocked(steps.carry).mockResolvedValue("wait");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        expect(state.clock).toBeGreaterThanOrEqual(ROOM_WAIT_MS);
        expect(state.chat?.carryTaken).toBe(true);
    });

    it("lets the chat go when the bot server says it is not theirs to bring", async () => {
        const { state, steps } = device();
        vi.mocked(steps.carry).mockResolvedValue("refused");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("none");
        expect(state.chat).toBeUndefined();
    });

    it("counts a chat the bot server already said as brought", async () => {
        const { steps } = device();
        vi.mocked(steps.carry).mockResolvedValue("already");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
    });

    it("runs once at a time however often the chat is opened, and says so while it runs, so the hello waits", async () => {
        const { steps } = device();
        let release: (value: "sent") => void = () => undefined;
        vi.mocked(steps.carry).mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            })
        );
        const first = bringGuestChat(steps);
        const second = bringGuestChat(steps);
        expect(second).toBe(first);
        expect(get(guestChatCarrying)).toBe(true);
        release("sent");
        await expect(first).resolves.toBe("carried");
        expect(get(guestChatCarrying)).toBe(false);
        expect(steps.take).toHaveBeenCalledTimes(1);
    });

    it("says nothing is carrying when there is nothing to carry", async () => {
        const { steps } = device(null);
        await expect(bringGuestChat(steps)).resolves.toBe("none");
        expect(get(guestChatCarrying)).toBe(false);
    });
});
