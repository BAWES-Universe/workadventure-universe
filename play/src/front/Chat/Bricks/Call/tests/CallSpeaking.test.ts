import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { writable } from "svelte/store";
import { watchBotSpeaking, type CallPeerLike, type CallPeersLike } from "../CallSpeaking";

function setup(existing?: CallPeerLike) {
    const added = new Subject<CallPeerLike>();
    const removed = new Subject<CallPeerLike>();
    const peers: CallPeersLike = {
        videoPeerAdded: added,
        videoPeerRemoved: removed,
        getVideoForUser: (id) => (id === "bot" ? existing : undefined),
    };
    const send = vi.fn();
    return { added, removed, peers, send };
}
const peer = () => {
    const speaking = writable(false);
    return { peer: { showVoiceIndicator: speaking } as CallPeerLike, speaking };
};

describe("the bot speaking in a call", () => {
    it("tells the call when the bot starts and stops speaking", () => {
        const t = setup();
        const stop = watchBotSpeaking(t.peers, [], t.send, () => 5);
        const bot = peer();
        t.added.next(bot.peer);
        bot.speaking.set(true);
        bot.speaking.set(false);
        expect(t.send.mock.calls.map(([e]) => e.speaking)).toEqual([false, true, false]);
        expect(t.send.mock.calls[0][0]).toMatchObject({ type: "bot-speaking", now: 5 });
        stop();
    });

    it("also watches a bot that was already there, and does not watch the same peer twice", () => {
        const bot = peer();
        const t = setup(bot.peer);
        const stop = watchBotSpeaking(t.peers, ["me", "bot"], t.send, () => 5);
        t.added.next(bot.peer);
        t.send.mockClear();
        bot.speaking.set(true);
        expect(t.send).toHaveBeenCalledTimes(1);
        stop();
    });

    it("says the bot stopped when its sound goes, and stops listening when told to", () => {
        const t = setup();
        const stop = watchBotSpeaking(t.peers, [], t.send, () => 5);
        const bot = peer();
        t.added.next(bot.peer);
        bot.speaking.set(true);
        t.send.mockClear();
        t.removed.next(bot.peer);
        expect(t.send).toHaveBeenCalledWith({ type: "bot-speaking", speaking: false, now: 5 });
        stop();
        t.send.mockClear();
        bot.speaking.set(false);
        expect(t.send).not.toHaveBeenCalled();
    });
});
