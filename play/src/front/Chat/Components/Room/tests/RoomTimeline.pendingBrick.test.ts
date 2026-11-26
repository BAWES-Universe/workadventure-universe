import { beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { writable } from "svelte/store";
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
        getPlayerName: () => "Khalid",
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
// A sign-in card is never used here, and the Bricks page it can open pulls in the native peer-to-peer module
vi.mock("../../../../external-modules/bots/index", () => ({ openBotPage: vi.fn() }));
vi.mock("../../../Connection/Matrix/MatrixMedia", () => ({ holdMatrixMedia: vi.fn() }));
vi.mock("../../../Connection/Matrix/MatrixChatUser", () => ({ chatUserFactory: () => undefined }));

import { PendingBrickChatRoom } from "../../../Bricks/PendingBrickChat";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import RoomTimeline from "../RoomTimeline.svelte";

describe("the timeline of a Brick's chat that is still being made", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
        // jsdom has no scrolling
        Element.prototype.scroll = () => undefined;
    });

    it("keeps the Brick's hello above the words written meanwhile, which show under it", async () => {
        const room = new PendingBrickChatRoom(
            writable({
                id: "0b7c1d2e-1111-4222-8333-944455556666",
                name: "Brick",
                description: null,
                characterTextureId: "brick-orange",
                enabled: true,
                isDefault: true,
                createdAt: "2026-11-11T10:00:00.000Z",
                hello: null,
            }),
            {
                now: () => Date.now(),
                setTimer: () => 0,
                clearTimer: () => undefined,
                sayStillLoading: () => undefined,
                isShown: () => true,
                retry: () => undefined,
            }
        );
        const target = document.createElement("div");
        document.body.appendChild(target);
        const view = new RoomTimeline({ target, props: { room } });
        await vi.waitFor(() => expect(target.querySelector('[data-testid="brickHello"]')).not.toBeNull());

        room.sendMessage("brief at 8?");
        await tick();
        await tick();
        expect(target.textContent).toContain("brief at 8?");
        // The hello stays: it gives way only when the chat takes the screen's place
        expect(target.querySelectorAll('[data-testid="brickHello"]')).toHaveLength(1);
        view.$destroy();
    });
});
