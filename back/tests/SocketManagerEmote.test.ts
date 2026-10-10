import { describe, expect, it, vi } from "vitest";
import type { GameRoom } from "../src/Model/GameRoom";
import type { User } from "../src/Model/User";
import { socketManager } from "../src/Services/SocketManager";

describe("SocketManager emote relay", () => {
    const user = { id: 42 } as User;

    it.each(["<b>x</b>", "<img src=x onerror=alert(1)>", "👍<svg onload=alert(1)>", "hello", ""])(
        "never broadcasts invalid emote %j",
        (emote) => {
            const emitEmoteEvent = vi.fn();
            const room = { emitEmoteEvent } as unknown as GameRoom;
            socketManager.handleEmoteEventMessage(room, user, { emote });
            expect(emitEmoteEvent).not.toHaveBeenCalled();
        }
    );

    it.each(["👍", "❤️", "😂", "👏", "😍", "🙏", "👋🏽", "🇰🇼", "1️⃣"])(
        "broadcasts emoji %s with the authenticated sender id",
        (emote) => {
            const emitEmoteEvent = vi.fn();
            const room = { emitEmoteEvent } as unknown as GameRoom;
            socketManager.handleEmoteEventMessage(room, user, { emote });
            expect(emitEmoteEvent).toHaveBeenCalledExactlyOnceWith(user, { emote, actorUserId: 42 });
        }
    );
});
