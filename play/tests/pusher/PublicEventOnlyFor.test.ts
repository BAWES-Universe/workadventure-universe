import type { PublicEventFrontToPusher } from "@workadventure/messages";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { onlyForOfBotsOnly } from "../../src/pusher/models/SpaceToFrontDispatcher";
import type { SpaceConnection } from "../../src/pusher/models/SpaceConnection";
import type { Socket } from "../../src/pusher/services/SocketManager";
import { SocketManager } from "../../src/pusher/services/SocketManager";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));

type Ev = NonNullable<Parameters<typeof onlyForOfBotsOnly>[0]>;

const spaceMessage = (onlyFor?: string) =>
    ({
        $case: "spaceMessage",
        spaceMessage: {
            message: "Your payslip",
            characterTextures: [],
            galleryUrls: [],
            fileNames: [],
            voiceWaveform: [],
            ...(onlyFor ? { onlyFor } : {}),
        },
    } as unknown as Extract<Ev, { $case: "spaceMessage" }>);

const streamMessage = (onlyFor?: string) =>
    ({
        $case: "spaceStreamMessage",
        spaceStreamMessage: { messageId: "m1", chunk: "Hello", ...(onlyFor ? { onlyFor } : {}) },
    } as unknown as Extract<Ev, { $case: "spaceStreamMessage" }>);

describe("only a bot may say that an event is for one person alone (what the sending socket forwards)", () => {
    const bot = { tags: ["bot"], uuid: "u-1" };
    const botByUuid = { tags: [], uuid: "bot-nora" };
    const person = { tags: ["member"], uuid: "u-2" };

    it("keeps the word of a bot, by its tag or by its uuid, on a message and on a stream", () => {
        for (const sender of [bot, botByUuid]) {
            const message = spaceMessage("room_7");
            expect(onlyForOfBotsOnly(message, sender)).toBe(message);
            const stream = streamMessage("room_7");
            expect(onlyForOfBotsOnly(stream, sender)).toBe(stream);
        }
    });

    it("clears it from anyone else, on a message and on a stream, without touching the rest or the original", () => {
        const message = spaceMessage("room_7");
        const cleared = onlyForOfBotsOnly(message, person);
        expect(cleared).toMatchObject({
            $case: "spaceMessage",
            spaceMessage: { message: "Your payslip", onlyFor: "" },
        });
        expect(message.spaceMessage.onlyFor).toBe("room_7");

        const stream = streamMessage("room_7");
        expect(onlyForOfBotsOnly(stream, person)).toMatchObject({
            $case: "spaceStreamMessage",
            spaceStreamMessage: { messageId: "m1", chunk: "Hello", onlyFor: "" },
        });
    });

    it("leaves an event that is for everyone as it is, whoever sent it", () => {
        const message = spaceMessage();
        expect(onlyForOfBotsOnly(message, person)).toBe(message);
        const other = { $case: "spaceIsTyping", spaceIsTyping: {} } as unknown as Ev;
        expect(onlyForOfBotsOnly(other, person)).toBe(other);
    });
});

describe("the public event a socket sends on to the space", () => {
    function managerWithSpace() {
        const socketManager = new SocketManager(mock<SpaceConnection>());
        const forwardMessageToSpaceBack = vi.fn();
        const space = { localName: "live", forwarder: { forwardMessageToSpaceBack } };
        (socketManager as unknown as { spaces: Map<string, unknown> }).spaces.set("w.live", space);
        return { socketManager, forwardMessageToSpaceBack };
    }
    const socketOf = (who: { tags: string[]; userUuid: string }): Socket =>
        ({
            getUserData: () => ({
                disconnecting: false,
                userId: 4,
                spaceUserId: "room_4",
                spaces: new Set<string>(["w.live"]),
                joinSpacesPromise: new Map<string, Promise<void>>(),
                ...who,
            }),
        } as unknown as Socket);
    const eventFor = (onlyFor?: string) =>
        ({ spaceName: "w.live", spaceEvent: { event: spaceMessage(onlyFor) } } as unknown as PublicEventFrontToPusher);
    const forwardedOnlyFor = (forward: ReturnType<typeof vi.fn>) =>
        (forward.mock.calls[0][0].publicEvent.spaceEvent.event.spaceMessage as { onlyFor?: string }).onlyFor;

    it("keeps who it is for when a bot sent it", async () => {
        const { socketManager, forwardMessageToSpaceBack } = managerWithSpace();
        await socketManager.handlePublicEvent(socketOf({ tags: ["bot"], userUuid: "u-1" }), eventFor("room_7"));
        expect(forwardedOnlyFor(forwardMessageToSpaceBack)).toBe("room_7");
        expect(forwardMessageToSpaceBack.mock.calls[0][0].publicEvent.senderUserId).toBe("room_4");
    });

    it("clears who it is for when anyone else sent it (an audience member of a stream that lists only its streamers)", async () => {
        const { socketManager, forwardMessageToSpaceBack } = managerWithSpace();
        await socketManager.handlePublicEvent(socketOf({ tags: [], userUuid: "u-2" }), eventFor("room_7"));
        expect(forwardedOnlyFor(forwardMessageToSpaceBack)).toBe("");
        // what else the event said, and who sent it, is untouched
        expect(forwardMessageToSpaceBack.mock.calls[0][0].publicEvent.spaceEvent.event.spaceMessage.message).toBe(
            "Your payslip"
        );
        expect(forwardMessageToSpaceBack.mock.calls[0][0].publicEvent.senderUserId).toBe("room_4");
    });

    it("forwards an event that is for everyone as it was", async () => {
        const { socketManager, forwardMessageToSpaceBack } = managerWithSpace();
        await socketManager.handlePublicEvent(socketOf({ tags: [], userUuid: "u-2" }), eventFor());
        expect(forwardedOnlyFor(forwardMessageToSpaceBack)).toBeUndefined();
    });
});
