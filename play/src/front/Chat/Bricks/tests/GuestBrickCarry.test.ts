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
        expect(steps.carry).toHaveBeenCalledWith(
            GUEST,
            [
                { id: "1.0", from: "guest", text: "Remember I take it without sugar", at: 2 },
                { id: "1.1", from: "brick", text: "I can only remember once I'm yours.", at: 3 },
            ],
            { from: 0, to: 2, last: true }
        );
        // Said once: what the device kept goes, so it is never said again
        expect(state.chat).toBeUndefined();
    });

    it("brings a long chat in parts, in order, and keeps the chat until every line is in", async () => {
        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 450; at++) long = withLine(long, { from: "guest", text: `line ${at}`, at });
        const { state, steps } = device(long);
        const kept: (number | undefined)[] = [];
        vi.mocked(steps.carry).mockImplementation(() => {
            kept.push(state.chat?.carriedTo);
            return Promise.resolve("sent");
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        const parts = vi.mocked(steps.carry).mock.calls.map(([, lines, part]) => ({ lines, part: part! }));
        expect(parts.length).toBeGreaterThan(2);
        expect(parts.flatMap(({ lines }) => lines.map((line) => line.at))).toEqual(
            Array.from({ length: 450 }, (_, i) => i + 1)
        );
        // Each part starts where the one before ended; only the last says so
        parts.forEach(({ part }, n) => expect(part.from).toBe(n === 0 ? 0 : parts[n - 1].part.to));
        expect(parts.map(({ part }) => part.last)).toEqual(parts.map((_, n) => n === parts.length - 1));
        // The device kept its chat, and where it got to, until the last part was in
        expect(kept).toEqual([undefined, ...parts.slice(0, -1).map(({ part }) => part.to)]);
        expect(state.chat).toBeUndefined();
    });

    it("goes on from the part it got to when a carry was cut short, never sending a part that is in twice", async () => {
        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 450; at++) long = withLine(long, { from: "guest", text: `line ${at}`, at });
        const { state, steps } = device(long);
        vi.mocked(steps.carry).mockResolvedValueOnce("sent").mockRejectedValueOnce(new Error("offline"));
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        const firstEnd = vi.mocked(steps.carry).mock.calls[0][2]!.to;
        expect(state.chat?.carriedTo).toBe(firstEnd);
        vi.mocked(steps.carry).mockReset().mockResolvedValue("sent");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(vi.mocked(steps.carry).mock.calls[0][2]!.from).toBe(firstEnd);
        expect(steps.take).toHaveBeenCalledTimes(1);
    });

    it("brings an answer that came back during sign-in in a part of its own, before the chat goes", async () => {
        const { state, steps } = device();
        vi.mocked(steps.carry)
            .mockImplementationOnce(() => {
                // The Brick for guests answered while the first part was on its way
                state.chat = withLine(state.chat!, { from: "brick", text: "Late answer.", at: 4 });
                return Promise.resolve("sent");
            })
            .mockResolvedValue("sent");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(steps.carry).toHaveBeenCalledTimes(2);
        expect(vi.mocked(steps.carry).mock.calls[1][1]).toEqual([
            { id: "1.2", from: "brick", text: "Late answer.", at: 4 },
        ]);
        expect(vi.mocked(steps.carry).mock.calls[1][2]).toEqual({ from: 2, to: 3, last: true });
        expect(state.chat).toBeUndefined();
    });

    it("sends the very same parts from two tabs at once, so the bot server says each once", async () => {
        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 300; at++) long = withLine(long, { from: "guest", text: `line ${at}`, at });
        const shared = device(long);
        const other: CarrySteps = { ...shared.steps, carry: vi.fn<CarrySteps["carry"]>().mockResolvedValue("already") };
        await Promise.all([carryGuestChatAlong(shared.steps), carryGuestChatAlong(other)]);
        const parts = (calls: Parameters<CarrySteps["carry"]>[]) =>
            calls.map(([, lines, part]) => ({ ids: lines.map((line) => line.id), part }));
        const mine = parts(vi.mocked(shared.steps.carry).mock.calls);
        const theirs = parts(vi.mocked(other.carry).mock.calls);
        // Whatever each tab sent is a part the other made the same way: same lines, same names
        for (const part of theirs) expect(mine).toContainEqual(part);
        expect(shared.state.chat).toBeUndefined();
    });

    it("brings the newest lines that fit as one message to a bot server from before, which takes no parts", async () => {
        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 450; at++) long = withLine(long, { from: "guest", text: `line ${at}`, at });
        const { state, steps } = device(long);
        steps.parts = vi.fn(() => Promise.resolve(false));
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(steps.carry).toHaveBeenCalledTimes(1);
        const [, lines, part] = vi.mocked(steps.carry).mock.calls[0];
        expect(part).toBeUndefined();
        expect(lines.at(-1)?.at).toBe(450);
        expect(state.chat).toBeUndefined();
    });

    it("tries again later when it can't ask the bot server how it takes the chat", async () => {
        const { state, steps } = device();
        steps.parts = vi.fn(() => Promise.reject(new Error("offline")));
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        expect(steps.carry).not.toHaveBeenCalled();
        expect(state.chat).toBeDefined();
    });

    it("keeps nothing when the chat was taken off the device while Orbit was being asked (signed out meanwhile)", async () => {
        const { state, steps } = device();
        steps.take = vi.fn<CarrySteps["take"]>().mockImplementation(() => {
            state.chat = undefined;
            return Promise.resolve(true);
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("none");
        expect(steps.calls).not.toContain("keep");
        expect(steps.carry).not.toHaveBeenCalled();
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
