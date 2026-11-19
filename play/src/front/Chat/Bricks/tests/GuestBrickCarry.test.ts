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
        // Both tabs have sent their first part before either gets an answer: they really were at it together
        let called = 0;
        let openGate: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            openGate = resolve;
        });
        const hold = (answer: "sent" | "already") =>
            vi.fn<CarrySteps["carry"]>(async () => {
                called += 1;
                if (called >= 2) openGate();
                await gate;
                return answer;
            });
        shared.steps.carry = hold("sent");
        const other: CarrySteps = { ...shared.steps, carry: hold("already") };
        await Promise.all([carryGuestChatAlong(shared.steps), carryGuestChatAlong(other)]);
        const parts = (calls: Parameters<CarrySteps["carry"]>[]) =>
            calls.map(([, lines, part]) => ({ ids: lines.map((line) => line.id), part }));
        const mine = parts(vi.mocked(shared.steps.carry).mock.calls);
        const theirs = parts(vi.mocked(other.carry).mock.calls);
        // Both tabs sent, and the first part each sent is the very same one: same lines, same names
        expect(mine.length).toBeGreaterThan(0);
        expect(theirs.length).toBeGreaterThan(0);
        expect(theirs[0]).toEqual(mine[0]);
        // Whatever each tab sent is a part the other made the same way
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

    it("sends a part whose answer was lost again with the very same lines, and brings a reply said since in the next part", async () => {
        const { state, steps } = device();
        // The bot server said lines 0-2, but the answer never came back; then the Brick for guests answered once more
        vi.mocked(steps.carry).mockImplementationOnce(() => {
            state.chat = withLine(state.chat!, { from: "brick", text: "Late answer.", at: 4 });
            return Promise.reject(new Error("connection lost"));
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        vi.mocked(steps.carry).mockReset().mockResolvedValueOnce("already").mockResolvedValue("sent");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        const calls = vi.mocked(steps.carry).mock.calls;
        // Unchanged: the part went first as the last one (nothing came after it yet), and goes again just so
        expect(calls.map(([, , part]) => part)).toEqual([
            { from: 0, to: 2, last: true },
            { from: 2, to: 3, last: true },
        ]);
        expect(calls[0][1].map((line) => line.id)).toEqual(["1.0", "1.1"]);
        expect(state.chat).toBeUndefined();
    });

    it("sends a lost part again with the lines as they were sent, even when a line of the transcript changed since", async () => {
        const { state, steps } = device();
        vi.mocked(steps.carry).mockImplementationOnce(() => {
            // The part went; the same line was kept again with other words before the answer was known
            const lines = [...state.chat!.lines];
            lines[1] = { ...lines[1], text: "Changed words." };
            state.chat = { ...state.chat!, lines };
            return Promise.reject(new Error("connection lost"));
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("later");
        vi.mocked(steps.carry).mockReset().mockResolvedValue("already");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(vi.mocked(steps.carry).mock.calls[0][1][1].text).toBe("I can only remember once I'm yours.");
    });

    it("keeps the new chat of another guest when Orbit refuses the old one after the chat was replaced", async () => {
        const { state, steps } = device();
        const other = { ...chatWithWords(), guestId: "9e9e9e9e-aaaa-4bbb-8ccc-0123456789ab", startedAt: 50 };
        vi.mocked(steps.take).mockImplementation(() => {
            state.chat = other;
            return Promise.resolve(false);
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("none");
        expect(steps.calls).not.toContain("drop");
        expect(state.chat).toBe(other);
    });

    it("still drops the chat Orbit refused when it is the same chat that is on the device", async () => {
        const { state, steps } = device();
        vi.mocked(steps.take).mockResolvedValue(false);
        await carryGuestChatAlong(steps);
        expect(steps.calls).toContain("drop");
        expect(state.chat).toBeUndefined();
    });

    it("keeps a reply saved while Orbit was being asked when it marks the chat as handed over", async () => {
        const { state, steps } = device();
        vi.mocked(steps.take).mockImplementation(() => {
            state.chat = withLine(state.chat!, { from: "brick", text: "A reply made meanwhile.", at: 9 });
            return Promise.resolve(true);
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        const lines = vi.mocked(steps.carry).mock.calls.flatMap(([, sent]) => sent.map((line) => line.text));
        expect(lines).toContain("A reply made meanwhile.");
    });

    it("never moves the place reached back when another tab got further", async () => {
        let long = newGuestChat(GUEST, 1);
        for (let at = 1; at <= 450; at++) long = withLine(long, { from: "guest", text: `line ${at}`, at });
        const { state, steps } = device(long);
        let calls = 0;
        const kept: Array<number | undefined> = [];
        const keep = steps.keep;
        steps.keep = (chat) => {
            kept.push(chat.carriedTo);
            keep(chat);
        };
        vi.mocked(steps.carry).mockImplementation(() => {
            calls += 1;
            // Another tab brought the first parts, and got further, while this one's first answer was on its way
            if (calls === 1) state.chat = { ...state.chat!, carriedTo: 400 };
            return Promise.resolve("sent");
        });
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        const reached = kept.filter((to): to is number => to !== undefined);
        expect(reached).toEqual([...reached].sort((a, b) => a - b));
        expect(Math.min(...reached.slice(-2))).toBeGreaterThanOrEqual(400);
        // Nothing before 400 is said again once the other tab had got that far
        expect(vi.mocked(steps.carry).mock.calls.length).toBeLessThan(4);
    });

    it("sends a bot server from before only the lines it has not taken, after a line said while the message was on its way", async () => {
        const { state, steps } = device();
        steps.parts = vi.fn(() => Promise.resolve(false));
        vi.mocked(steps.carry)
            .mockImplementationOnce(() => {
                state.chat = withLine(state.chat!, { from: "brick", text: "Late answer.", at: 4 });
                return Promise.resolve("already");
            })
            .mockResolvedValue("sent");
        await expect(carryGuestChatAlong(steps)).resolves.toBe("carried");
        expect(steps.carry).toHaveBeenCalledTimes(2);
        expect(vi.mocked(steps.carry).mock.calls[1][1].map((line) => line.text)).toEqual(["Late answer."]);
    });

    it("leaves another guest's chat alone when a refusal comes back after the chat was replaced", async () => {
        const { state, steps } = device();
        const other = { ...chatWithWords(), guestId: "9e9e9e9e-aaaa-4bbb-8ccc-0123456789ab", startedAt: 50 };
        let refuse: (value: "refused") => void = () => undefined;
        vi.mocked(steps.carry).mockImplementation(
            () =>
                new Promise((resolve) => {
                    refuse = resolve;
                })
        );
        const carrying = carryGuestChatAlong(steps);
        await vi.waitFor(() => expect(steps.carry).toHaveBeenCalled());
        // Signed out and another guest started talking while the question was open
        state.chat = other;
        refuse("refused");
        await expect(carrying).resolves.toBe("none");
        expect(state.chat).toBe(other);
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

    it("never hands the run of one account to another: the second account waits for it and then carries by its own steps", async () => {
        const first = device();
        const second = device();
        let release: (value: "sent") => void = () => undefined;
        vi.mocked(first.steps.carry).mockReturnValue(
            new Promise((resolve) => {
                release = resolve;
            })
        );
        const one = bringGuestChat(first.steps, "account-one");
        expect(bringGuestChat(first.steps, "account-one")).toBe(one);
        const two = bringGuestChat(second.steps, "account-two");
        expect(two).not.toBe(one);
        // The other account has not started before the first one is done
        await Promise.resolve();
        expect(second.steps.take).not.toHaveBeenCalled();
        release("sent");
        await expect(one).resolves.toBe("carried");
        await expect(two).resolves.toBe("carried");
        expect(second.steps.take).toHaveBeenCalledTimes(1);
        expect(second.steps.carry).toHaveBeenCalledTimes(1);
        expect(get(guestChatCarrying)).toBe(false);
    });

    it("says nothing is carrying when there is nothing to carry", async () => {
        const { steps } = device(null);
        await expect(bringGuestChat(steps)).resolves.toBe("none");
        expect(get(guestChatCarrying)).toBe(false);
    });
});
