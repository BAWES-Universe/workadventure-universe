import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SayMessageType } from "@workadventure/messages";
import type { RoomConnection } from "../../../../Connection/RoomConnection";
import type { Player } from "../../../Player/Player";
import { SayManager } from "../SayManager";

vi.mock("../../../Player/Player", () => ({ hasMovedEventName: "hasMoved" }));

class FakePlayer extends EventEmitter {
    public readonly said: { text: string; type: SayMessageType }[] = [];
    say(text: string, type: SayMessageType): void {
        this.said.push({ text, type });
    }
    move(): void {
        this.emit("hasMoved", { moving: true, direction: 0, x: 0, y: 0 });
    }
}

describe("SayManager", () => {
    let player: FakePlayer;
    let sent: { message: string; type: SayMessageType }[];
    let manager: SayManager;

    beforeEach(() => {
        vi.useFakeTimers();
        player = new FakePlayer();
        sent = [];
        const connection = {
            emitPlayerSayMessage: (message: { message: string; type: SayMessageType }) => sent.push(message),
        } as unknown as RoomConnection;
        manager = new SayManager(connection, player as unknown as Player);
    });

    afterEach(() => {
        manager.close();
        vi.useRealTimers();
    });

    it("sends the text, then the empty clear after the duration", () => {
        manager.say("hi", SayMessageType.SpeechBubble, 5000);
        expect(sent).toEqual([{ message: "hi", type: SayMessageType.SpeechBubble }]);
        vi.advanceTimersByTime(5000);
        expect(sent.at(-1)).toEqual({ message: "", type: SayMessageType.SpeechBubble });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("repeated Think keeps a single movement listener", () => {
        manager.say("a", SayMessageType.ThinkingCloud, undefined);
        manager.say("b", SayMessageType.ThinkingCloud, undefined);
        manager.say("c", SayMessageType.ThinkingCloud, undefined);
        expect(player.listenerCount("hasMoved")).toBe(1);
        player.move();
        expect(sent.filter((m) => m.message === "")).toHaveLength(1);
        expect(player.listenerCount("hasMoved")).toBe(0);
    });

    it("Think then Say removes the Think listener, so moving does not clear the Say", () => {
        manager.say("thinking", SayMessageType.ThinkingCloud, undefined);
        manager.say("hello", SayMessageType.SpeechBubble, 5000);
        expect(player.listenerCount("hasMoved")).toBe(0);
        player.move();
        expect(sent.at(-1)).toEqual({ message: "hello", type: SayMessageType.SpeechBubble });
    });

    it("Say then Think then move clears only the Think", () => {
        manager.say("hello", SayMessageType.SpeechBubble, 5000);
        manager.say("thinking", SayMessageType.ThinkingCloud, undefined);
        player.move();
        expect(player.said.at(-1)).toEqual({ text: "", type: SayMessageType.ThinkingCloud });
        expect(sent.at(-1)).toEqual({ message: "", type: SayMessageType.ThinkingCloud });
    });

    it("close clears timers and listeners", () => {
        manager.say("thinking", SayMessageType.ThinkingCloud, undefined);
        manager.say("hello", SayMessageType.SpeechBubble, 5000);
        manager.say("thinking again", SayMessageType.ThinkingCloud, 5000);
        manager.close();
        expect(vi.getTimerCount()).toBe(0);
        expect(player.listenerCount("hasMoved")).toBe(0);
    });
});
