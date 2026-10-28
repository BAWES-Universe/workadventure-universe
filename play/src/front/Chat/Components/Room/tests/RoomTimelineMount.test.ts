import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { readable, writable } from "svelte/store";
import { Subject } from "rxjs";
import type { SpaceInterface } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";
import type { RemotePlayersRepository } from "../../../../Phaser/Game/RemotePlayersRepository";
import type { ChatRoom } from "../../../Connection/ChatConnection";

// The front reads its configuration from window.env at import time.
vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

// Anything the timeline asks the game for: every property is another one, every call returns one, and as a store or
// a stream it holds nothing.
function anything(): unknown {
    return new Proxy(() => undefined, {
        get(_target, property) {
            if (property === "subscribe") {
                return (run: unknown) => {
                    if (typeof run === "function") run(undefined);
                    // Works as a store's unsubscribe and as an rxjs subscription
                    return Object.assign(() => undefined, { unsubscribe: () => undefined });
                };
            }
            if (property === "then" || property === Symbol.iterator) return undefined;
            if (property === Symbol.toPrimitive) return () => "";
            return anything();
        },
        apply: () => anything(),
    });
}

vi.mock("@workadventure/simple-peer", () => ({ default: class {} }));
vi.mock("../../../../Api/IframeListener", () => ({ iframeListener: anything() }));
vi.mock("../../../../Phaser/Game/GameScene", () => ({ GameScene: class {} }));
vi.mock("../../../../Phaser/Game/GameManager", () => ({ gameManager: anything() }));
// The input bar keeps drafts in IndexedDB, which the test browser doesn't have; the timeline is what is tested here.
vi.mock("../MessageInputBar.svelte", async () => ({ default: (await import("./EmptyStub.svelte")).default }));
vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => ({
    CharacterLayerManager: { wokaBase64: () => Promise.resolve("") },
}));
vi.mock("../../../../WebRtc/AudioStream/ScriptingOutputAudioStreamManager", () => ({
    ScriptingOutputAudioStreamManager: class {
        close(): void {}
    },
}));
vi.mock("../../../../WebRtc/AudioStream/ScriptingInputAudioStreamManager", () => ({
    ScriptingInputAudioStreamManager: class {
        close(): void {}
    },
}));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import { ProximityChatRoom } from "../../../Connection/Proximity/ProximityChatRoom";
import { NAME_BY_CHAT_ID_CONTEXT } from "../../../Stores/ChatUserWokaStore";
import RoomTimeline from "../RoomTimeline.svelte";

function fakeSpace() {
    const events = new Map<string, Subject<unknown>>();
    const event = (name: string) => {
        let subject = events.get(name);
        if (!subject) {
            subject = new Subject<unknown>();
            events.set(name, subject);
        }
        return subject.asObservable();
    };
    return {
        destroyed: false,
        usersStore: writable(new Map()),
        observeUserJoined: new Subject(),
        observeUserLeft: new Subject(),
        onLeaveSpace: new Subject<void>(),
        observePublicEvent: event,
        observePrivateEvent: event,
        emitPublicMessage: vi.fn(),
        getName: () => "bubble",
    } as unknown as SpaceInterface;
}

describe("RoomTimeline", () => {
    loadLocale("en-US");
    setLocale("en-US");

    let destroy = () => undefined as void;
    afterEach(() => {
        destroy();
        document.body.innerHTML = "";
    });

    async function mount(room: ChatRoom) {
        const target = document.createElement("div");
        document.body.appendChild(target);
        // The game would give the timeline the names people go by; here nobody is known yet
        const context = new Map([[NAME_BY_CHAT_ID_CONTEXT, readable(new Map<string, string>())]]);
        const component = new RoomTimeline({ target, props: { room }, context });
        destroy = () => component.$destroy();
        await tick();
        return target;
    }

    it("opens a nearby chat", async () => {
        // A nearby chat says it is "direct" and has no members list: the timeline must still work out who the
        // other person is only once it knows there are no members.
        const room = new ProximityChatRoom(
            "room_1",
            {
                joinSpace: () => Promise.resolve(fakeSpace()),
                leaveSpace: () => Promise.resolve(),
            } as unknown as SpaceRegistryInterface,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        await room.joinSpace("bubble", [], true);
        const target = await mount(room);
        expect(target.querySelector("[data-testid=roomName]")?.textContent).toBe("Proximity Chat");
        expect(target.querySelector("[data-testid=botDmIntro]")).toBeNull();
        room.destroy();
    });
});
