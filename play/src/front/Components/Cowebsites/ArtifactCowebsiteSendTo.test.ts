/* eslint-disable no-await-in-loop -- the tests wait for the screen to settle, one step after another */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, writable } from "svelte/store";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const api = vi.hoisted(() => ({
    fetchArtifact: vi.fn(),
    fetchArtifactCode: vi.fn(),
}));
vi.mock("../../Artifacts/ArtifactApi", () => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string) {
            super(code);
        }
    }
    return {
        ArtifactRequestError,
        artifactLink: (id: string) => `https://orbit.test/a/${id}`,
        fetchArtifact: api.fetchArtifact,
        fetchArtifactCode: api.fetchArtifactCode,
        fetchArtifactVersions: vi.fn(() => Promise.resolve([])),
        restoreArtifactVersion: vi.fn(),
        shareArtifact: vi.fn(),
        payOnArtifact: vi.fn(),
    };
});
vi.mock("../EmbedScreens/OpenHereRow.svelte", async () => ({
    default: (await import("./ArtifactTestStub.svelte")).default,
}));
vi.mock("../EmbedScreens/OpenHereItemIcon.svelte", async () => ({
    default: (await import("./ArtifactTestStub.svelte")).default,
}));
vi.mock("./FileViewer/CodeView.svelte", async () => ({ default: (await import("./ArtifactTestStub.svelte")).default }));

import { loadLocale } from "../../../i18n/i18n-util.sync";
import { setLocale } from "../../../i18n/i18n-svelte";
import { closeSendTo, sendToRequest } from "../../Artifacts/sendToStore";
import ArtifactCowebsiteComponent from "./ArtifactCowebsiteComponent.svelte";

const WITH_TABLE = "# Calendar notes\n\n| # | Note |\n|---|---|\n| 1 | Call Laura |\n";
const NO_TABLE = "# Packing list\n\nPassport, charger.\n";

function opened(options: {
    owner: boolean;
    openScope: string;
    published?: { version: number; at: string; available?: boolean } | null;
}) {
    return {
        artifact: {
            id: "d1",
            title: "Calendar notes",
            kind: "markdown",
            makerName: "Nudge Brick",
            version: 2,
            openScope: options.openScope,
            changeScope: "owner",
            chatKind: null,
            expiresAt: null,
            published: options.published,
        },
        version: {
            number: 2,
            summary: null,
            askedByName: null,
            sizeBytes: 10,
            createdAt: "2026-11-11T10:00:00.000Z",
            url: null,
        },
        you: { owner: options.owner, change: false, manage: false, copy: false },
    };
}

const settle = async () => {
    for (let i = 0; i < 6; i++) await tick();
    await Promise.resolve();
    await tick();
};

function mount() {
    const cowebsite = {
        artifactId: "d1",
        chat: undefined,
        version: writable<number | undefined>(undefined),
        summary: writable({ title: "Calendar notes", kind: "markdown", makerName: "Nudge Brick" }),
    };
    const target = document.createElement("div");
    document.body.appendChild(target);
    const view = new ArtifactCowebsiteComponent({
        target,
        props: { actualCowebsite: cowebsite as never, visible: true },
    });
    return { target, view };
}

const open = async (text: string, document: Parameters<typeof opened>[0]) => {
    api.fetchArtifact.mockResolvedValue(opened(document));
    api.fetchArtifactCode.mockResolvedValue({ version: { number: 2 }, content: text });
    const mounted = mount();
    await settle();
    return mounted;
};

const byId = (target: HTMLElement, testId: string) => target.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

describe("Send to in a document's Download list", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        closeSendTo();
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("is a row of the list for the owner, beside the table choices", async () => {
        const { target, view } = await open(WITH_TABLE, { owner: true, openScope: "me" });
        byId(target, "artifactDownload")?.click();
        await settle();
        expect(byId(target, "artifactDownloadMarkdown")).not.toBeNull();
        expect(byId(target, "artifactDownloadSheet")).not.toBeNull();
        expect(byId(target, "artifactSendTo")?.textContent).toContain("Send to…");
        view.$destroy();
    });

    it("makes a list even for a document with no table, with the file and Send to", async () => {
        const { target, view } = await open(NO_TABLE, { owner: true, openScope: "me" });
        byId(target, "artifactDownload")?.click();
        await settle();
        expect(byId(target, "artifactDownloadMarkdown")).not.toBeNull();
        // There is no table, so no spreadsheet choice
        expect(byId(target, "artifactDownloadSheet")).toBeNull();
        expect(byId(target, "artifactSendTo")).not.toBeNull();
        view.$destroy();
    });

    it("is offered to someone who is not the owner only when the document opens by its link", async () => {
        for (const [openScope, offered] of [
            ["link", true],
            ["public", true],
            ["chat", false],
            ["me", false],
        ] as const) {
            const { target, view } = await open(WITH_TABLE, { owner: false, openScope });
            byId(target, "artifactDownload")?.click();
            await settle();
            expect(byId(target, "artifactSendTo") !== null, `${openScope}`).toBe(offered);
            view.$destroy();
            document.body.innerHTML = "";
        }
    });

    it("keeps the one-tap download when a document with no table has nobody to be sent on by", async () => {
        const created = vi.fn(() => "blob:saved");
        const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
        const { target, view } = await open(NO_TABLE, { owner: false, openScope: "chat" });
        byId(target, "artifactDownload")?.click();
        await settle();
        // No list: the tap made the file
        expect(byId(target, "artifactDownloadMenu")).toBeNull();
        expect(created).toHaveBeenCalledOnce();
        expect(clicked).toHaveBeenCalledOnce();
        expect(byId(target, "artifactDownloadNote")?.textContent).toContain("Calendar notes.md");
        expect(get(sendToRequest)).toBeUndefined();
        view.$destroy();
        clicked.mockRestore();
        vi.unstubAllGlobals();
    });

    it("opens the sheet with the file of the version on show and the document's link setting", async () => {
        const { target, view } = await open(WITH_TABLE, {
            owner: true,
            openScope: "link",
            published: { version: 1, at: "2026-11-10T10:00:00.000Z", available: true },
        });
        byId(target, "artifactDownload")?.click();
        await settle();
        byId(target, "artifactSendTo")?.click();
        await settle();

        const request = get(sendToRequest);
        expect(request?.fileName).toBe("Calendar notes.md");
        const file = await request?.makeFile();
        expect(file?.name).toBe("Calendar notes.md");
        expect(file?.size).toBe(WITH_TABLE.length);
        expect(request?.link).toEqual({
            url: "https://orbit.test/a/d1",
            openScope: "link",
            owner: true,
            published: { version: 1, at: "2026-11-10T10:00:00.000Z", available: true },
            latest: 2,
        });
        // The list closes behind the tap
        expect(byId(target, "artifactDownloadMenu")).toBeNull();
        view.$destroy();
    });
});
