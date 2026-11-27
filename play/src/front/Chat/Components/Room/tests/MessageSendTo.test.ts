import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable } from "svelte/store";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});
vi.mock("../Details/Pins", () => ({
    pinActionOf: () => readable(undefined),
    runPinAction: vi.fn(),
}));
vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectedChatMessageToEdit: writable(null), selectedChatMessageToReply: writable(null) };
});
vi.mock("../../../../Stores/NotificationStore", () => ({ notificationPlayingStore: { playNotification: vi.fn() } }));
vi.mock("../../../Stores/CopiedPillStore", () => ({ showCopiedPill: vi.fn() }));
vi.mock("../../../../Utils/svelte-floatingui-show", () => ({ showFloatingUi: vi.fn() }));
vi.mock("../../../../Components/EmoteMenu/LazyEmote.svelte", () => ({ default: {} }));
vi.mock("../MessageActions/saveFiles", () => ({ saveFiles: vi.fn(), prepareFiles: vi.fn() }));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import type { ChatMessage, ChatMessageContent, ChatMessageType } from "../../../Connection/ChatConnection";
import { closeSendTo, sendToRequest } from "../../../../Artifacts/sendToStore";
import MessageActionMenu from "../MessageActions/MessageActionMenu.svelte";
import MessageMoreMenu from "../MessageActions/MessageMoreMenu.svelte";
import { hasAnyAction, availableActions } from "../MessageActions/availableActions";

function content(partial: Partial<ChatMessageContent>): ChatMessageContent {
    return { body: "", url: undefined, urls: undefined, filename: undefined, fileNames: undefined, ...partial };
}

function message(type: ChatMessageType, body: Partial<ChatMessageContent>, mine = false): ChatMessage {
    return {
        id: "m1",
        type,
        isMyMessage: mine,
        content: readable(content(body)),
        canReact: readable(true),
        canReply: readable(true),
        canDelete: readable(false),
    } as unknown as ChatMessage;
}

const FILE = { body: "Calendar notes.md", url: "blob:notes", filename: "Calendar notes.md" };

describe("Send to on a message's menus", () => {
    let shown: { $destroy: () => void } | undefined;
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        closeSendTo();
        document.body.innerHTML = "";
        vi.restoreAllMocks();
    });

    const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

    function pressAndHoldMenu(chatMessage: ChatMessage) {
        const anchor = document.createElement("div");
        document.body.appendChild(anchor);
        shown = new MessageActionMenu({
            target: document.body,
            props: { message: chatMessage, anchor, onClose: vi.fn() },
        });
        return tick();
    }

    it("is on a file card's press-and-hold menu, after Reply and Save", async () => {
        await pressAndHoldMenu(message("file", FILE));
        const rows = Array.from(document.querySelectorAll('[role="menuitem"]')).map((row) => row.textContent?.trim());
        expect(rows).toEqual(["Reply", "Save file", "Send to…"]);
    });

    it("opens the sheet for the file, which is read only when Send is pressed", async () => {
        await pressAndHoldMenu(message("file", FILE));
        const fetched = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["# Notes"])) });
        vi.stubGlobal("fetch", fetched);
        q("menuSendToButton")?.click();
        await tick();

        const request = get(sendToRequest);
        expect(request?.fileName).toBe("Calendar notes.md");
        // A chat file has no link to offer
        expect(request?.link).toBeUndefined();
        expect(fetched).not.toHaveBeenCalled();
        const file = await request?.makeFile();
        expect(fetched).toHaveBeenCalledWith("blob:notes", { mode: "cors", credentials: "omit" });
        expect(file?.name).toBe("Calendar notes.md");
        vi.unstubAllGlobals();
    });

    it("is on the hover bar's More menu too", async () => {
        shown = new MessageMoreMenu({
            target: document.body,
            props: { message: message("file", FILE), trigger: document.createElement("button"), onClose: vi.fn() },
        });
        await tick();
        expect(q("sendMessageFileToButton")?.textContent).toContain("Send to…");
        q("sendMessageFileToButton")?.click();
        await tick();
        expect(get(sendToRequest)?.fileName).toBe("Calendar notes.md");
    });

    it("is not on words, pictures, songs, videos, galleries or a card holding several files", () => {
        for (const type of ["text", "image", "audio", "video", "gallery"] as const) {
            const actions = get(availableActions(message(type, { ...FILE, body: "hello" })));
            expect(actions.sendTo, type).toBeUndefined();
        }
        const several = get(
            availableActions(message("file", { url: "blob:a", urls: ["blob:b"], fileNames: ["a.md", "b.md"] }))
        );
        expect(several.sendTo).toBeUndefined();
    });

    it("counts as an action, so a file card with nothing else to offer still has its menu", () => {
        const base = {
            react: false,
            reply: false,
            copyText: undefined,
            files: [],
            edit: false,
            delete: false,
            pin: undefined,
        };
        expect(hasAnyAction({ ...base, sendTo: undefined })).toBe(false);
        expect(hasAnyAction({ ...base, sendTo: { url: "blob:a", name: "a.md" } })).toBe(true);
    });
});
