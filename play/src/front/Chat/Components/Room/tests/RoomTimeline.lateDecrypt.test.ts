import { beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, writable } from "svelte/store";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { MatrixEventEvent } from "matrix-js-sdk";
import { SearchableArrayStore } from "@workadventure/store-utils";
import type * as MyBricksStoreModule from "../../../Bricks/MyBricksStore";
import type * as DirectPartnerStoreModule from "../DirectChat/DirectPartnerStore";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        MATRIX_ADMIN_USER: "admin",
        MATRIX_DOMAIN: "domain",
    };
});
// The tests run Svelte's server build, where onMount does nothing: the client build draws the timeline
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../Services/DraftMessageService", () => ({
    draftMessageService: {
        loadDraft: () => Promise.resolve(undefined),
        getDraft: () => Promise.resolve(undefined),
        saveDraft: vi.fn(),
        deleteDraft: vi.fn(),
    },
}));
vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            room: { isChatEnabled: true },
            userProviderMerger: new Promise(() => {
                // never settles: the users of the map do not matter here
            }),
        }),
        chatConnection: {},
    },
}));
vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => ({ CharacterLayerManager: {} }));
vi.mock("../../../../Rules/StatusRules/statusChangerFunctions", () => ({}));
vi.mock("../../../../Phaser/Game/UI/UIWebsiteManager", () => ({ uiWebsiteManager: {} }));
vi.mock("../DirectChat/DirectPartnerStore", async (importOriginal) => {
    const { writable: store } = await import("svelte/store");
    return {
        ...(await importOriginal<typeof DirectPartnerStoreModule>()),
        directPartnerStore: () =>
            store({
                chatId: "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test",
                user: undefined,
                uuid: undefined,
                place: { kind: "offline" },
                actions: { walkTo: false, locate: false },
                isBot: true,
                isBlocked: false,
                isGameBlocked: false,
            }),
    };
});
vi.mock("../../../Bricks/MyBricksStore", async (importOriginal) => {
    const { readable } = await import("svelte/store");
    return {
        ...(await importOriginal<typeof MyBricksStoreModule>()),
        myBricksByChatId: readable(
            new Map([["@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test", { id: "brick-1", name: "Brick" }]])
        ),
        loadMyBricks: () => Promise.resolve(),
        loadMyBricksAfterPending: () => Promise.resolve(true),
    };
});
vi.mock("../../../Connection/Matrix/MatrixMedia", () => ({ holdMatrixMedia: vi.fn() }));
vi.mock("../../../Connection/Matrix/MatrixChatUser", () => ({ chatUserFactory: () => undefined }));

import { MatrixChatRoom } from "../../../Connection/Matrix/MatrixChatRoom";
import type { MatrixChatMessage } from "../../../Connection/Matrix/MatrixChatMessage";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import LL, { setLocale } from "../../../../../i18n/i18n-svelte";
import RoomTimeline from "../RoomTimeline.svelte";

const ME = "@me:matrix.test";
const BRICK = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";

/** An encrypted Brick message whose keys arrive after the room took it in. */
function encryptedFromBrick() {
    let content: Record<string, unknown> = { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "..." };
    const listeners: (() => void)[] = [];
    const event = {
        getId: () => "$late",
        getDate: () => new Date(0),
        localTimestamp: 5,
        getSender: () => BRICK,
        getContent: () => content,
        getOriginalContent: () => content,
        getUnsigned: () => ({}),
        isDecryptionFailure: () => false,
        isRedacted: () => false,
        replacingEventId: () => undefined,
        replyEventId: undefined,
        on: (name: string, listener: () => void) => {
            if (name === MatrixEventEvent.Decrypted) listeners.push(listener);
        },
        off: () => {},
    } as unknown as MatrixEvent;
    return {
        event,
        decrypt: (clear: Record<string, unknown>) => {
            content = clear;
            listeners.forEach((listener) => listener());
        },
    };
}

const matrixRoom = {
    client: { getUserId: () => ME, getSafeUserId: () => ME, getUser: () => null },
    getMember: () => null,
    getLiveTimeline: () => ({ getState: () => undefined }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
} as unknown as Room;

describe("the timeline of a chat with a Brick whose message is decrypted after it came in", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    it("shows the Brick's card of ideas once the late decryption says so, without the list of messages being built again", async () => {
        const room = Object.create(MatrixChatRoom.prototype) as MatrixChatRoom;
        Object.assign(room, {
            matrixRoom,
            id: "!r:matrix.test",
            name: writable("Brick"),
            type: "direct",
            isEncrypted: writable(false),
            isLoadingMessages: writable(false),
            pictureStore: writable(undefined),
            hasPermissionTo: () => writable(false),
            pinnedMessageIds: writable([]),
            typingMembers: writable([]),
            sessions: writable([]),
            currentSessionId: writable(undefined),
            isChatUploadEnabled: writable(false),
            takeUnsentDraft: () => undefined,
            setTimelineAsRead: () => undefined,
            currentRoomMember: writable({ permissionLevel: writable(0) }),
            messages: new SearchableArrayStore<string, MatrixChatMessage>((item) => item.id),
            members: writable([{ id: BRICK, membership: writable("join"), stoppedTyping: () => undefined }]),
            noteBubbles: new Map(),
            noteTranscripts: new Map(),
            addEventContentInMemory: () => undefined,
        });
        const { event, decrypt } = encryptedFromBrick();
        room["handleNewMessage"](event, false);

        const target = document.createElement("div");
        document.body.appendChild(target);
        const view = new RoomTimeline({ target, props: { room } });
        await tick();
        // Still encrypted: no card
        expect(target.textContent).not.toContain("A few things");

        decrypt({ msgtype: "m.text", body: "A few things I could take off your plate.", "universe.brick_ideas": true });
        await tick();
        await tick();
        expect(target.textContent).toContain(get(LL).chat.brick.ideasTitle());
        view.$destroy();
    });
});
