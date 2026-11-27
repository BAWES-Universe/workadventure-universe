import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import type * as SvelteRuntime from "svelte";
import { get, readable } from "svelte/store";

vi.mock("svelte", async (importOriginal) => {
    const svelte = await importOriginal<typeof SvelteRuntime>();
    // eslint-disable-next-line svelte/no-svelte-internal
    const { onMount } = await import("svelte/internal");
    return { ...svelte, onMount };
});

const api = vi.hoisted(() => {
    class ArtifactRequestError extends Error {
        constructor(public readonly status: number, public readonly code: string) {
            super(code);
        }
    }
    return {
        ArtifactRequestError,
        fetchArtifact: vi.fn(),
        fetchArtifactVersions: vi.fn(),
        fetchArtifactCode: vi.fn(),
        restoreArtifactVersion: vi.fn(),
        shareArtifact: vi.fn(),
        publishArtifact: vi.fn(),
        payOnArtifact: vi.fn(),
        artifactLink: (id: string) => `https://orbit.test/a/${id}`,
    };
});
vi.mock("../../../src/front/Artifacts/ArtifactApi", () => api);
// The window reads whether the person is signed in (for the guest receipt line); the real store needs the browser's env
vi.mock("../../../src/front/Connection/LocalUserStore", () => ({ localUserStore: { isLogged: vi.fn(() => false) } }));
// Who is in the nearby chat with you now, as the Share menu names them
const nearby = vi.hoisted(() => ({ nearbyPeopleNames: vi.fn() }));
vi.mock("../../../src/front/Artifacts/nearbyPeople", () => nearby);
// Every text is the key it comes from, so the test reads the parts by their test ids.
vi.mock("../../../src/i18n/i18n-svelte", () => {
    const deep = (): unknown => new Proxy(() => "", { get: () => deep() });
    return { default: readable(deep()), locale: readable("en") };
});

import ArtifactCowebsiteComponent from "../../../src/front/Components/Cowebsites/ArtifactCowebsiteComponent.svelte";
import { ArtifactCoWebsite } from "../../../src/front/WebRtc/CoWebsite/ArtifactCoWebsite";
import { chatOwnSheetHeightStore } from "../../../src/front/Chat/ChatSheetStore";
import { windowSize } from "../../../src/front/Stores/CoWebsiteStore";
import { openHereRoomRequestStore } from "../../../src/front/Stores/OpenHereSheetStore";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

function opened(
    number: number,
    latest = 3,
    kind = "app",
    owner = true,
    chatKind: string | null = "nearby",
    inChat = true
) {
    return {
        artifact: {
            id: ID,
            title: "Quests board",
            kind,
            makerName: "Scout",
            version: latest,
            openScope: "chat",
            changeScope: "owner",
            chatKind,
            expiresAt: null,
        },
        version: {
            number,
            summary: null,
            askedByName: null,
            sizeBytes: 10,
            createdAt: "2026-10-26T10:00:00Z",
            url: `https://artifacts.test/v${number}.html`,
        },
        you: { owner, change: owner, manage: owner, copy: true, inChat },
    };
}

function byTestId(id: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
}

describe("the artifact window", () => {
    let target: HTMLElement;
    let component: { $destroy(): void } | undefined;

    beforeEach(() => {
        vi.clearAllMocks();
        nearby.nearbyPeopleNames.mockReturnValue(readable(["Laura", "Sam", "Omar"]));
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    function mountWindow(version?: number, kind: "app" | "markdown" = "app") {
        const website = new ArtifactCoWebsite(
            ID,
            { kind: "nearby", ref: "bubble" },
            { title: "Quests board", kind, makerName: "Scout" },
            version
        );
        component = new ArtifactCowebsiteComponent({ target, props: { actualCowebsite: website, visible: true } });
        return website;
    }

    it("opens the version asked for in a locked frame, with no note when it is the latest", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3));
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        const frame = byTestId("artifactFrame") as HTMLIFrameElement;
        // A tapped link opens in a new tab as the other site itself; the frame never gets the game's origin or its tab
        expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
        expect(frame.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        expect(byTestId("artifactOldNote")).toBeNull();
        expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
        expect(api.fetchArtifact).toHaveBeenCalledWith(ID, { kind: "nearby", ref: "bubble" }, 3);
        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);
    });

    it("writes the latest version back when it was opened without one", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3));
        const website = mountWindow();
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());
        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);
        await tick();
        expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
    });

    it("opens an earlier version once, with the note, and goes back to the latest", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 3))
        );
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        website.version.set(1);
        await vi.waitFor(() => expect(byTestId("artifactOldNote")).not.toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html");
        expect(api.fetchArtifact).toHaveBeenCalledTimes(2);

        byTestId("artifactOldNote")?.querySelector<HTMLButtonElement>("button")?.click();
        await vi.waitFor(() => expect(byTestId("artifactOldNote")).toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
    });

    it("keeps the version on show when another one cannot be opened, and still opens it again", async () => {
        api.fetchArtifact.mockResolvedValueOnce(opened(3));
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        api.fetchArtifact.mockRejectedValueOnce(new api.ArtifactRequestError(404, "version_not_found"));
        website.version.set(1);
        await vi.waitFor(() => expect(byTestId("artifactSwitchFailed")).not.toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);

        api.fetchArtifact.mockResolvedValueOnce(opened(1));
        website.version.set(1);
        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html")
        );
        expect(byTestId("artifactSwitchFailed")).toBeNull();
    });

    it("drops an opening that is still on its way when the version on show is chosen again", async () => {
        api.fetchArtifact.mockResolvedValueOnce(opened(3));
        const website = mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

        let arrive: (value: unknown) => void = () => undefined;
        api.fetchArtifact.mockReturnValueOnce(
            new Promise((resolve) => {
                arrive = resolve;
            })
        );
        website.version.set(1);
        await tick();
        website.version.set(3);
        await tick();
        arrive(opened(1));
        await new Promise((resolve) => {
            setTimeout(resolve, 20);
        });

        let shown: number | undefined;
        website.version.subscribe((value) => (shown = value))();
        expect(shown).toBe(3);
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html");
        expect(byTestId("artifactVersions")).not.toBeNull();
    });

    it("reads a document again when its text could not be read and Try again is tapped", async () => {
        api.fetchArtifact.mockResolvedValue(opened(1, 1, "markdown"));
        api.fetchArtifactCode.mockRejectedValueOnce(new Error("offline"));
        api.fetchArtifactCode.mockResolvedValueOnce({ version: opened(1, 1).version, content: "# Notes" });
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        mountWindow(1, "markdown");
        await vi.waitFor(() =>
            expect(document.querySelector('[data-testid="artifactDocument"] button')).not.toBeNull()
        );

        document.querySelector<HTMLButtonElement>('[data-testid="artifactDocument"] button')?.click();
        await vi.waitFor(() => expect(byTestId("artifactDocument")?.textContent).toContain("Notes"));
        expect(api.fetchArtifactCode).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it("reads the code of the version on show when Code is on", async () => {
        api.fetchArtifact.mockResolvedValue(opened(2, 2));
        api.fetchArtifactCode.mockResolvedValue({ version: opened(2, 2).version, content: "<h1>Hi</h1>\n<p>x</p>" });
        mountWindow(2);
        await vi.waitFor(() => expect(byTestId("artifactCode")).not.toBeNull());

        byTestId("artifactCode")?.click();
        await vi.waitFor(() => expect(byTestId("artifactCodeView")?.textContent).toContain("<h1>Hi</h1>"));
        expect(byTestId("codeView")?.querySelector(".code-meta")?.textContent).toContain("HTML");
        expect(byTestId("codeView")?.querySelectorAll(".code-line")).toHaveLength(2);
        expect(api.fetchArtifactCode).toHaveBeenCalledTimes(1);
        expect(byTestId("artifactFrame")).toBeNull();
    });

    it("lists the versions when asked and opens the one picked", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 2, 2))
        );
        api.fetchArtifactVersions.mockResolvedValue([opened(2, 2).version, opened(1, 2).version]);
        mountWindow(2);
        await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());

        byTestId("artifactVersions")?.click();
        await vi.waitFor(() => expect(byTestId("artifactVersionMenu")?.querySelectorAll(".menu-row")).toHaveLength(2));
        byTestId("artifactVersionMenu")?.querySelectorAll<HTMLButtonElement>(".menu-row")[1].click();

        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html")
        );
        expect(byTestId("artifactVersionMenu")).toBeNull();
    });

    it("drops the list down above the chat, asks the window for room once when it has none, and closes on a tap elsewhere", async () => {
        api.fetchArtifact.mockResolvedValue(opened(2, 2));
        api.fetchArtifactVersions.mockResolvedValue([opened(2, 2).version, opened(1, 2).version]);
        const screen = get(windowSize).height;
        const box = (top: number) =>
            ({ top, bottom: screen, left: 0, right: 428, width: 428, height: screen - top, x: 0, y: top } as DOMRect);
        // The window shows only its row above the chat: the list would start where the chat begins.
        chatOwnSheetHeightStore.set(screen - 300);
        const rect = vi
            .spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockImplementation(function (this: HTMLElement) {
                return box(this.classList.contains("menu") ? 300 : 180);
            });
        const asked = get(openHereRoomRequestStore);
        mountWindow(2);
        await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());

        byTestId("artifactVersions")?.click();
        await vi.waitFor(() => expect(byTestId("artifactVersionMenu")?.querySelectorAll(".menu-row")).toHaveLength(2));
        expect(byTestId("artifactVersionMenu")?.classList.contains("in-sheet")).toBe(false);
        expect(byTestId("artifactVersionMenu")?.style.maxHeight).toBe("0px");
        expect(get(openHereRoomRequestStore)).toBe(asked + 1);

        // The window rose to the top behind the chat: the list ends above the chat's top, and nothing more is asked.
        rect.mockImplementation(function (this: HTMLElement) {
            return box(this.classList.contains("menu") ? 60 : 0);
        });
        chatOwnSheetHeightStore.set(screen - 400);
        await tick();
        expect(byTestId("artifactVersionMenu")?.style.maxHeight).toBe(`${400 - 60 - 12}px`);
        expect(get(openHereRoomRequestStore)).toBe(asked + 1);

        // A tap inside the list keeps it; a tap anywhere else puts it away.
        byTestId("artifactVersionMenu")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        await tick();
        expect(byTestId("artifactVersionMenu")).not.toBeNull();
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        await tick();
        expect(byTestId("artifactVersionMenu")).toBeNull();

        rect.mockRestore();
        chatOwnSheetHeightStore.set(0);
    });

    it("counts a version made while the window stayed open as the latest once the list shows it", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 2, 2))
        );
        api.fetchArtifactVersions.mockResolvedValue([opened(3, 3).version, opened(2, 3).version, opened(1, 3).version]);
        mountWindow(2);
        await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());
        expect(byTestId("artifactOldNote")).toBeNull();

        byTestId("artifactVersions")?.click();
        await vi.waitFor(() => expect(byTestId("artifactVersionMenu")?.querySelectorAll(".menu-row")).toHaveLength(3));
        await vi.waitFor(() => expect(byTestId("artifactOldNote")).not.toBeNull());

        byTestId("artifactOldNote")?.querySelector<HTMLButtonElement>("button")?.click();
        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html")
        );
    });

    it("lets the owner restore an older version, which then opens as the new latest", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 3, version === 4 ? 4 : 3))
        );
        let restored: (answer: ReturnType<typeof opened>) => void = () => {};
        api.restoreArtifactVersion.mockReturnValue(
            new Promise((resolve) => {
                restored = resolve;
            })
        );
        api.fetchArtifactVersions.mockResolvedValue([opened(3, 3).version, opened(1, 3).version]);
        mountWindow(1);
        await vi.waitFor(() => expect(byTestId("artifactRestore")).not.toBeNull());

        // The list opened while the restore is on its way is put away once it is done.
        byTestId("artifactRestore")?.click();
        byTestId("artifactVersions")?.click();
        await vi.waitFor(() => expect(byTestId("artifactVersionMenu")?.querySelectorAll(".menu-row")).toHaveLength(2));
        restored(opened(4, 4));
        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v4.html")
        );
        expect(api.restoreArtifactVersion).toHaveBeenCalledWith(ID, 1, { kind: "nearby", ref: "bubble" });
        expect(byTestId("artifactOldNote")).toBeNull();
        expect(byTestId("artifactVersionMenu")).toBeNull();
    });

    it("stays on the version the person went on to while a restore was on its way", async () => {
        api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
            Promise.resolve(opened(version ?? 3, 3))
        );
        let restored: (answer: ReturnType<typeof opened>) => void = () => {};
        api.restoreArtifactVersion.mockReturnValue(
            new Promise((resolve) => {
                restored = resolve;
            })
        );
        const website = mountWindow(1);
        await vi.waitFor(() => expect(byTestId("artifactRestore")).not.toBeNull());

        byTestId("artifactRestore")?.click();
        website.version.set(2);
        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v2.html")
        );
        restored(opened(4, 4));
        await tick();
        await tick();
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v2.html");
        expect(api.fetchArtifact).not.toHaveBeenCalledWith(ID, expect.anything(), 4);
    });

    it("offers no restore to someone who is not the owner, and says so when a restore fails", async () => {
        api.fetchArtifact.mockResolvedValue(opened(1, 3, "app", false));
        mountWindow(1);
        await vi.waitFor(() => expect(byTestId("artifactOldNote")).not.toBeNull());
        expect(byTestId("artifactRestore")).toBeNull();
        component?.$destroy();

        api.fetchArtifact.mockResolvedValue(opened(1, 3));
        api.restoreArtifactVersion.mockRejectedValue(new api.ArtifactRequestError(409, "stale_version"));
        mountWindow(1);
        await vi.waitFor(() => expect(byTestId("artifactRestore")).not.toBeNull());
        byTestId("artifactRestore")?.click();
        await vi.waitFor(() => expect(byTestId("artifactRestoreFailed")).not.toBeNull());
        expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v1.html");

        // Going back to the latest leaves the failure behind with the version it was about.
        api.fetchArtifact.mockResolvedValue(opened(3, 3));
        byTestId("artifactOldNote")?.querySelector<HTMLButtonElement>("button")?.click();
        await vi.waitFor(() =>
            expect(byTestId("artifactFrame")?.getAttribute("src")).toBe("https://artifacts.test/v3.html")
        );
        expect(byTestId("artifactRestoreFailed")).toBeNull();
    });

    it("lets only the owner share: the link is turned on at once, saved, and copied", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3));
        api.fetchArtifactVersions.mockResolvedValue([]);
        let saved: (artifact: unknown) => void = () => {};
        api.shareArtifact.mockReturnValue(
            new Promise((resolve) => {
                saved = resolve;
            })
        );
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactShare")).not.toBeNull());

        // One list at a time: Share puts the Versions list away
        byTestId("artifactVersions")?.click();
        await vi.waitFor(() => expect(byTestId("artifactVersionMenu")).not.toBeNull());
        byTestId("artifactShare")?.click();
        await vi.waitFor(() => expect(byTestId("artifactShareMenu")).not.toBeNull());
        expect(byTestId("artifactVersionMenu")).toBeNull();
        expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
        expect(byTestId("artifactCopyLink")).toBeNull();

        byTestId("artifactOpenLink")?.click();
        await tick();
        expect(api.shareArtifact).toHaveBeenCalledWith(ID, { openScope: "link" }, { kind: "nearby", ref: "bubble" });
        expect(byTestId("artifactOpenLink")?.getAttribute("aria-checked")).toBe("true");
        // Nothing else is sent until it is saved
        byTestId("artifactOpenChat")?.click();
        expect(api.shareArtifact).toHaveBeenCalledTimes(1);

        // The link shows at once, but it is copied only once it works
        expect((byTestId("artifactCopyLink") as HTMLButtonElement).disabled).toBe(true);
        saved({ ...opened(3).artifact, openScope: "link" });
        await vi.waitFor(() => expect((byTestId("artifactCopyLink") as HTMLButtonElement).disabled).toBe(false));
        byTestId("artifactCopyLink")?.click();
        await vi.waitFor(() => expect(byTestId("artifactLinkCopied")).not.toBeNull());
        expect(writeText).toHaveBeenCalledWith(`https://orbit.test/a/${ID}`);

        // Picking what is already saved sends nothing
        byTestId("artifactOpenLink")?.click();
        expect(api.shareArtifact).toHaveBeenCalledTimes(1);

        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        await vi.waitFor(() => expect(byTestId("artifactShareMenu")).toBeNull());
    });

    it("goes back to what was saved when sharing fails, and shows the link when it cannot be copied", async () => {
        api.fetchArtifact.mockResolvedValue({ ...opened(3), artifact: { ...opened(3).artifact, openScope: "link" } });
        api.shareArtifact.mockRejectedValue(new api.ArtifactRequestError(0, "offline"));
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: () => Promise.reject(new Error("denied")) },
            configurable: true,
        });
        mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactShare")).not.toBeNull());
        byTestId("artifactShare")?.click();
        await vi.waitFor(() => expect(byTestId("artifactCopyLink")).not.toBeNull());

        byTestId("artifactCopyLink")?.click();
        await vi.waitFor(() => expect(byTestId("artifactLinkText")?.textContent).toBe(`https://orbit.test/a/${ID}`));

        byTestId("artifactOpenChat")?.click();
        await vi.waitFor(() => expect(byTestId("artifactShareFailed")).not.toBeNull());
        expect(byTestId("artifactOpenLink")?.getAttribute("aria-checked")).toBe("true");
        expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("false");
    });

    describe("Publish (game #2115)", () => {
        const CHAT = { kind: "nearby", ref: "bubble" };

        /** An artifact shared the way the test says, with what was published (none by default). */
        function sharedAs(
            openScope: string,
            latest: number,
            published?: { version: number; at?: string; available?: boolean },
            owner = true
        ) {
            const base = opened(latest, latest, "app", owner);
            return {
                ...base,
                artifact: {
                    ...base.artifact,
                    openScope,
                    published: published ? { at: "2026-11-20T09:12:00Z", ...published } : null,
                },
            };
        }

        it("makes Public the choice after the link, and asks to publish before it gives a link", async () => {
            api.fetchArtifact.mockResolvedValue(opened(3));
            api.fetchArtifactVersions.mockResolvedValue([]);
            let saved: (artifact: unknown) => void = () => {};
            api.shareArtifact.mockReturnValue(
                new Promise((resolve) => {
                    saved = resolve;
                })
            );
            api.publishArtifact.mockResolvedValue({
                ...sharedAs("public", 3).artifact,
                published: { version: 3, at: "2026-11-20T09:12:00Z" },
            });
            mountWindow(3);
            await openShareMenu();
            expect(byTestId("artifactNotPublished")).toBeNull();
            expect(byTestId("artifactPublish")).toBeNull();

            byTestId("artifactOpenPublic")?.click();
            await tick();
            expect(api.shareArtifact).toHaveBeenCalledWith(ID, { openScope: "public" }, CHAT);
            // Nothing is published, so there is no link to give yet; and Publish waits until Public is saved
            expect(byTestId("artifactOpenPublic")?.getAttribute("aria-checked")).toBe("true");
            expect(byTestId("artifactNotPublished")).not.toBeNull();
            expect(byTestId("artifactCopyLink")).toBeNull();
            expect((byTestId("artifactPublish") as HTMLButtonElement).disabled).toBe(true);
            saved(sharedAs("public", 3).artifact);
            await vi.waitFor(() => expect((byTestId("artifactPublish") as HTMLButtonElement).disabled).toBe(false));

            byTestId("artifactPublish")?.click();
            await tick();
            expect(api.publishArtifact).toHaveBeenCalledWith(ID, 3, CHAT);
            await vi.waitFor(() => expect(byTestId("artifactPublished")).not.toBeNull());
            expect(byTestId("artifactNotPublished")).toBeNull();
            // Up to date: no Publish beside the status, and the link is there to copy
            expect(byTestId("artifactPublish")).toBeNull();
            expect(byTestId("artifactCopyLink")).not.toBeNull();
        });

        it("keeps who can open it as it was while a publish is on its way, and never writes it over with the answer", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("public", 3));
            let done: (artifact: unknown) => void = () => {};
            api.publishArtifact.mockReturnValue(
                new Promise((resolve) => {
                    done = resolve;
                })
            );
            mountWindow(3);
            await openShareMenu();
            byTestId("artifactPublish")?.click();
            await tick();
            // The choices wait, so nothing can be saved that the answer would then undo
            expect((byTestId("artifactOpenLink") as HTMLButtonElement).disabled).toBe(true);
            byTestId("artifactOpenLink")?.click();
            expect(api.shareArtifact).not.toHaveBeenCalled();

            // The answer was made before anything else changed: it says what was published and nothing about sharing
            done({ ...sharedAs("link", 3).artifact, published: { version: 3, at: "2026-11-20T09:12:00Z" } });
            await vi.waitFor(() => expect(byTestId("artifactPublished")).not.toBeNull());
            expect(byTestId("artifactOpenPublic")?.getAttribute("aria-checked")).toBe("true");
            expect((byTestId("artifactOpenLink") as HTMLButtonElement).disabled).toBe(false);
        });

        it("keeps what was published when the page was being opened again from before it, as it moves out of Just you", async () => {
            api.fetchArtifact.mockResolvedValueOnce(sharedAs("me", 3));
            api.shareArtifact.mockResolvedValue({ ...sharedAs("public", 3).artifact });
            mountWindow(3);
            await openShareMenu();
            // Public from Just you opens the version on show again; that answer is slow and was made before the publish
            let slowOpening: (answer: unknown) => void = () => {};
            api.fetchArtifact.mockReturnValueOnce(
                new Promise((resolve) => {
                    slowOpening = resolve;
                })
            );
            api.publishArtifact.mockResolvedValue({
                ...sharedAs("public", 3).artifact,
                published: { version: 3, at: "2026-11-20T09:12:00Z" },
            });
            byTestId("artifactOpenPublic")?.click();
            await vi.waitFor(() => expect(api.fetchArtifact).toHaveBeenCalledTimes(2));
            await vi.waitFor(() => expect((byTestId("artifactPublish") as HTMLButtonElement).disabled).toBe(false));
            byTestId("artifactPublish")?.click();
            await vi.waitFor(() => expect(byTestId("artifactPublished")).not.toBeNull());

            slowOpening(sharedAs("public", 3));
            await tick();
            await tick();
            // Still published: the late answer did not put it back to "Not published yet"
            expect(byTestId("artifactPublished")).not.toBeNull();
            expect(byTestId("artifactNotPublished")).toBeNull();
        });

        it("publishes only the version on show: a newer one is opened first, and then it is the one that is sent", async () => {
            api.fetchArtifact.mockImplementation((_id: string, _chat: unknown, version?: number) =>
                Promise.resolve(
                    version === 4 ? sharedAs("public", 4, { version: 3 }) : sharedAs("public", 3, { version: 3 })
                )
            );
            api.fetchArtifactVersions.mockResolvedValue([opened(4, 4).version, opened(3, 4).version]);
            api.publishArtifact.mockResolvedValue({
                ...sharedAs("public", 4).artifact,
                published: { version: 4, at: "2026-11-24T09:12:00Z" },
            });
            mountWindow(3);
            // Version 4 shows in the list while version 3 is still the one on show
            await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());
            byTestId("artifactVersions")?.click();
            await vi.waitFor(() => expect(byTestId("artifactOldNote")).not.toBeNull());
            // The bar is not offered for a version the owner has not opened
            expect(byTestId("artifactPublishBar")).toBeNull();

            await openShareMenu();
            expect(byTestId("artifactPublish")).toBeNull();
            byTestId("artifactPublishOpenLatest")?.click();
            await vi.waitFor(() => expect(api.fetchArtifact).toHaveBeenLastCalledWith(ID, CHAT, 4));
            expect(api.publishArtifact).not.toHaveBeenCalled();

            // Opened now, so it can be published, and that exact version is what is sent
            await vi.waitFor(() => expect(byTestId("artifactPublish")).not.toBeNull());
            byTestId("artifactPublish")?.click();
            await tick();
            expect(api.publishArtifact).toHaveBeenCalledWith(ID, 4, CHAT);
            // Up to date now, so nothing is left to publish
            await vi.waitFor(() => expect(byTestId("artifactPublish")).toBeNull());
            expect(byTestId("artifactPublished")).not.toBeNull();
        });

        it("takes the answer's word on what was published when only a sharing choice came back meanwhile", async () => {
            const published = { version: 3, available: true };
            api.fetchArtifact.mockResolvedValueOnce(sharedAs("me", 3, published));
            api.shareArtifact
                .mockResolvedValueOnce(sharedAs("public", 3, published).artifact)
                .mockResolvedValueOnce(sharedAs("link", 3, published).artifact);
            mountWindow(3);
            await openShareMenu();
            // Public from Just you opens the page again; that answer is slow, and says the published version is gone
            let slowOpening: (answer: unknown) => void = () => {};
            api.fetchArtifact.mockReturnValueOnce(
                new Promise((resolve) => {
                    slowOpening = resolve;
                })
            );
            byTestId("artifactOpenPublic")?.click();
            await vi.waitFor(() => expect(api.fetchArtifact).toHaveBeenCalledTimes(2));
            // A sharing choice comes back before it does
            await vi.waitFor(() => expect((byTestId("artifactOpenLink") as HTMLButtonElement).disabled).toBe(false));
            byTestId("artifactOpenLink")?.click();
            await vi.waitFor(() => expect(byTestId("artifactOpenLink")?.getAttribute("aria-checked")).toBe("true"));

            slowOpening(sharedAs("public", 3, { version: 3, available: false }));
            await vi.waitFor(() => expect(byTestId("artifactPublishedGone")).not.toBeNull());
            // What the owner chose last still stands
            expect(byTestId("artifactOpenLink")?.getAttribute("aria-checked")).toBe("true");
        });

        it("says a link that was never published shows the latest version, and offers no Publish", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("link", 3));
            mountWindow(3);
            await openShareMenu();
            expect(byTestId("artifactLinkFollows")).not.toBeNull();
            expect(byTestId("artifactPublish")).toBeNull();
            expect(byTestId("artifactNotPublished")).toBeNull();
            expect(byTestId("artifactCopyLink")).not.toBeNull();
        });

        it("tells the owner in the window when the latest version is newer than the published one, and publishes from there", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("public", 4, { version: 3 }));
            api.publishArtifact.mockResolvedValue({
                ...sharedAs("public", 4).artifact,
                published: { version: 4, at: "2026-11-20T10:00:00Z" },
            });
            mountWindow(4);
            await vi.waitFor(() => expect(byTestId("artifactUnpublished")).not.toBeNull());

            byTestId("artifactPublishBar")?.click();
            await tick();
            expect(api.publishArtifact).toHaveBeenCalledWith(ID, 4, CHAT);
            expect((byTestId("artifactPublishBar") as HTMLButtonElement).disabled).toBe(true);
            await vi.waitFor(() => expect(byTestId("artifactUnpublished")).toBeNull());
        });

        it("keeps the bar and says so when publishing fails, and tries again on the next tap", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("link", 4, { version: 3 }));
            api.publishArtifact.mockRejectedValueOnce(new api.ArtifactRequestError(0, "offline"));
            mountWindow(4);
            await vi.waitFor(() => expect(byTestId("artifactUnpublished")).not.toBeNull());
            byTestId("artifactPublishBar")?.click();
            await vi.waitFor(() => expect(byTestId("artifactPublishFailed")).not.toBeNull());
            expect(byTestId("artifactUnpublished")).not.toBeNull();

            api.publishArtifact.mockResolvedValue({
                ...sharedAs("link", 4).artifact,
                published: { version: 4, at: "2026-11-20T10:00:00Z" },
            });
            byTestId("artifactPublishBar")?.click();
            await vi.waitFor(() => expect(byTestId("artifactUnpublished")).toBeNull());
            expect(byTestId("artifactPublishFailed")).toBeNull();
        });

        it("offers Publish in Share beside the status when a newer version is there, and puts the bar away while Share is open", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("public", 5, { version: 3 }));
            api.publishArtifact.mockResolvedValue({
                ...sharedAs("public", 5).artifact,
                published: { version: 5, at: "2026-11-20T10:00:00Z" },
            });
            mountWindow(5);
            await vi.waitFor(() => expect(byTestId("artifactUnpublished")).not.toBeNull());
            await openShareMenu();
            expect(byTestId("artifactUnpublished")).toBeNull();
            expect(byTestId("artifactPublished")).not.toBeNull();
            // The link is there to copy: version 3 is what it shows
            expect(byTestId("artifactCopyLink")).not.toBeNull();

            byTestId("artifactPublish")?.click();
            await tick();
            expect(api.publishArtifact).toHaveBeenCalledWith(ID, 5, CHAT);
            await vi.waitFor(() => expect(byTestId("artifactPublish")).toBeNull());
            expect(byTestId("artifactPublished")).not.toBeNull();
        });

        it("offers one button to publish again when the published version is gone, and gives no link meanwhile", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("public", 5, { version: 3, available: false }));
            mountWindow(5);
            await openShareMenu();
            expect(byTestId("artifactPublishedGone")).not.toBeNull();
            expect(byTestId("artifactPublish")).not.toBeNull();
            expect(byTestId("artifactCopyLink")).toBeNull();
            // The bar speaks of a published version that is there: not this one
            expect(byTestId("artifactUnpublished")).toBeNull();
        });

        it("shows no bar when it is only for its chat, or to someone who is not the owner", async () => {
            api.fetchArtifact.mockResolvedValue(sharedAs("chat", 4, { version: 3 }));
            mountWindow(4);
            await vi.waitFor(() => expect(byTestId("artifactShare")).not.toBeNull());
            expect(byTestId("artifactUnpublished")).toBeNull();
            component?.$destroy();
            api.fetchArtifact.mockResolvedValue(sharedAs("public", 4, { version: 3 }, false));
            mountWindow(4);
            await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());
            expect(byTestId("artifactUnpublished")).toBeNull();
            expect(byTestId("artifactShare")).toBeNull();
        });
    });

    async function openShareMenu() {
        await vi.waitFor(() => expect(byTestId("artifactShare")).not.toBeNull());
        byTestId("artifactShare")?.click();
        await vi.waitFor(() => expect(byTestId("artifactShareMenu")).not.toBeNull());
    }

    it("names the people in the nearby chat it was made in while the owner is in it, and asks nothing about changes", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3));
        mountWindow(3);
        await openShareMenu();
        expect(byTestId("artifactOpenChatPeople")?.textContent).toBe("Laura, Sam, Omar");
        expect(nearby.nearbyPeopleNames).toHaveBeenCalledWith("bubble");
        expect(byTestId("artifactOpenJustYou")).toBeNull();
        expect(byTestId("artifactChangeOwner")).toBeNull();
        expect(byTestId("artifactChangeOpeners")).toBeNull();
        expect(byTestId("artifactShareMenu")?.querySelectorAll(".menu-title")).toHaveLength(1);
        expect(byTestId("artifactShareMenu")?.querySelector(".menu-note")).not.toBeNull();
    });

    it("reads Just you when the owner is not in the nearby chat it was made in", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3, 3, "app", true, "nearby", false));
        mountWindow(3);
        await openShareMenu();
        expect(byTestId("artifactOpenJustYou")).not.toBeNull();
        expect(byTestId("artifactOpenChatPeople")).toBeNull();
        expect(nearby.nearbyPeopleNames).not.toHaveBeenCalled();
        // Saved as before: the same choice, under the words that are true for it now
        expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
        expect(byTestId("artifactShareMenu")?.querySelector(".menu-note")).toBeNull();
    });

    it("reads Just you for an artifact made in a direct message", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3, 3, "app", true, "dm", false));
        mountWindow(3);
        await openShareMenu();
        expect(byTestId("artifactOpenJustYou")).not.toBeNull();
        expect(byTestId("artifactOpenChatPeople")).toBeNull();
    });

    it("opens the device's share sheet beside Copy link, and copies only when the sheet cannot open", async () => {
        api.fetchArtifact.mockResolvedValue({ ...opened(3), artifact: { ...opened(3).artifact, openScope: "link" } });
        api.fetchArtifactVersions.mockResolvedValue([]);
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const share = vi.fn(() => Promise.reject(new DOMException("closed", "AbortError")));
        Object.defineProperty(navigator, "share", { value: share, configurable: true });
        try {
            mountWindow(3);
            await vi.waitFor(() => expect(byTestId("artifactShare")).not.toBeNull());
            byTestId("artifactShare")?.click();
            await vi.waitFor(() => expect(byTestId("artifactShareLink")).not.toBeNull());
            expect(byTestId("artifactCopyLink")).not.toBeNull();

            // Closing the sheet copies nothing
            byTestId("artifactShareLink")?.click();
            expect(share).toHaveBeenCalledWith({ title: "Quests board", url: `https://orbit.test/a/${ID}` });
            await tick();
            await tick();
            expect(writeText).not.toHaveBeenCalled();
            expect(byTestId("artifactLinkCopied")).toBeNull();

            // A sheet that cannot open copies instead, so the tap never does nothing
            share.mockImplementation(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
            byTestId("artifactShareLink")?.click();
            await vi.waitFor(() => expect(byTestId("artifactLinkCopied")).not.toBeNull());
            expect(writeText).toHaveBeenCalledWith(`https://orbit.test/a/${ID}`);
        } finally {
            Reflect.deleteProperty(navigator, "share");
        }
    });

    it("keeps Copy link alone where the device has no share sheet", async () => {
        api.fetchArtifact.mockResolvedValue({ ...opened(3), artifact: { ...opened(3).artifact, openScope: "link" } });
        api.fetchArtifactVersions.mockResolvedValue([]);
        mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactShare")).not.toBeNull());
        byTestId("artifactShare")?.click();
        await vi.waitFor(() => expect(byTestId("artifactCopyLink")).not.toBeNull());
        expect(byTestId("artifactShareLink")).toBeNull();
    });

    describe("Just you (game #1994)", () => {
        const DM = { kind: "dm" as const, chatKind: "dm" };
        /** The artifact as its owner opens it, shared as `openScope`; made in a direct message unless said. */
        function shared(openScope: string, chatKind: string | null = DM.chatKind, inChat = false) {
            const answer = opened(3, 3, "app", true, chatKind, inChat);
            return { ...answer, artifact: { ...answer.artifact, openScope } };
        }
        /** The same, at an address made for that one opening, which stops after `urlLifeMs`. */
        function openedPrivately(pass: string, urlLifeMs: number, urlHasMedia?: boolean) {
            const answer = shared("me");
            const url = `https://orbit.test/af/${pass}/3/index.html`;
            return {
                ...answer,
                version: { ...answer.version, url, urlLifeMs, ...(urlHasMedia ? { urlHasMedia } : {}) },
            };
        }
        const srcOfFrame = () => byTestId("artifactFrame")?.getAttribute("src");

        afterEach(() => {
            vi.useRealTimers();
        });

        it("is the first choice in the chat it was made in, saved at once, and the page opens again where its files went", async () => {
            api.fetchArtifact.mockResolvedValue(opened(3));
            api.shareArtifact.mockResolvedValue({ ...opened(3).artifact, openScope: "me" });
            mountWindow(3);
            await openShareMenu();
            const rows = [...(byTestId("artifactShareMenu")?.querySelectorAll('[role="radio"]') ?? [])];
            expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
                "artifactOpenMe",
                "artifactOpenChat",
                "artifactOpenLink",
                "artifactOpenPublic",
            ]);
            expect(byTestId("artifactOpenMe")?.getAttribute("aria-checked")).toBe("false");
            expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
            expect(byTestId("artifactJustYouNote")).toBeNull();

            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000));
            byTestId("artifactOpenMe")?.click();
            await tick();
            expect(api.shareArtifact).toHaveBeenCalledWith(ID, { openScope: "me" }, { kind: "nearby", ref: "bubble" });
            await vi.waitFor(() => expect(byTestId("artifactJustYouNote")).not.toBeNull());
            expect(byTestId("artifactOpenMe")?.getAttribute("aria-checked")).toBe("true");
            expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("false");
            // The address it had stops with the switch: the version on show is asked for again, and drawn from the new one
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));
            expect(api.fetchArtifact).toHaveBeenCalledTimes(2);
            expect(api.fetchArtifact).toHaveBeenLastCalledWith(ID, { kind: "nearby", ref: "bubble" }, 3);
            // The list stayed open through it
            expect(byTestId("artifactShareMenu")).not.toBeNull();
        });

        it("opens the page again at the bucket's address when its owner widens it", async () => {
            api.fetchArtifact.mockResolvedValue({
                ...openedPrivately("PASS1", 600_000),
                artifact: { ...shared("me", "nearby", true).artifact },
                you: shared("me", "nearby", true).you,
            });
            api.shareArtifact.mockResolvedValue({ ...opened(3).artifact, openScope: "chat" });
            mountWindow(3);
            await openShareMenu();
            expect(byTestId("artifactOpenMe")?.getAttribute("aria-checked")).toBe("true");

            api.fetchArtifact.mockResolvedValue(opened(3));
            byTestId("artifactOpenChat")?.click();
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://artifacts.test/v3.html"));
            expect(api.shareArtifact).toHaveBeenCalledWith(
                ID,
                { openScope: "chat" },
                { kind: "nearby", ref: "bubble" }
            );
            expect(byTestId("artifactJustYouNote")).toBeNull();
        });

        it.each(["chat", "me"])(
            "stays one choice away from its chat: picked for both ways of keeping it, and a tap on it sends nothing (%s)",
            async (openScope) => {
                api.fetchArtifact.mockResolvedValue(shared(openScope));
                mountWindow(3);
                await openShareMenu();
                expect(byTestId("artifactOpenMe")).toBeNull();
                expect(byTestId("artifactOpenJustYou")).not.toBeNull();
                expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
                expect(byTestId("artifactOpenLink")?.getAttribute("aria-checked")).toBe("false");
                // Its line says the file itself is kept only where it is: with its chat it reads as it always did
                expect(byTestId("artifactOpenJustYouOnly") !== null).toBe(openScope === "me");
                // The note is about the chat's other people, and nobody else is in this one
                expect(byTestId("artifactJustYouNote")).toBeNull();
                byTestId("artifactOpenChat")?.click();
                await tick();
                expect(api.shareArtifact).not.toHaveBeenCalled();
            }
        );

        it("keeps the file itself to its owner when picked after a link, so what the link gave out stops", async () => {
            api.fetchArtifact.mockResolvedValue(shared("link"));
            api.shareArtifact.mockResolvedValue({ ...shared("me").artifact });
            mountWindow(3);
            await openShareMenu();
            expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("false");
            // What picking it will do is said before the tap
            expect(byTestId("artifactOpenJustYouOnly")).not.toBeNull();

            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000));
            byTestId("artifactOpenChat")?.click();
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));
            expect(api.shareArtifact).toHaveBeenCalledTimes(1);
            expect(api.shareArtifact).toHaveBeenCalledWith(ID, { openScope: "me" }, { kind: "nearby", ref: "bubble" });
            expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
            expect(byTestId("artifactCopyLink")).toBeNull();
        });

        it.each([
            [503, "private_files_not_configured"],
            [422, "invalid_open_scope"],
        ])(
            "goes back to its chat, as before, where the server cannot keep files private (%i %s)",
            async (status, code) => {
                api.fetchArtifact.mockResolvedValue(shared("link"));
                api.shareArtifact.mockRejectedValueOnce(new api.ArtifactRequestError(status, code));
                api.shareArtifact.mockResolvedValueOnce({ ...shared("chat").artifact });
                mountWindow(3);
                await openShareMenu();
                byTestId("artifactOpenChat")?.click();
                await vi.waitFor(() => expect(api.shareArtifact).toHaveBeenCalledTimes(2));
                expect(api.shareArtifact).toHaveBeenNthCalledWith(
                    1,
                    ID,
                    { openScope: "me" },
                    { kind: "nearby", ref: "bubble" }
                );
                expect(api.shareArtifact).toHaveBeenLastCalledWith(
                    ID,
                    { openScope: "chat" },
                    { kind: "nearby", ref: "bubble" }
                );
                await vi.waitFor(() => expect(byTestId("artifactCopyLink")).toBeNull());
                expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
                expect(byTestId("artifactShareFailed")).toBeNull();
                // It does not say the file itself is kept, and is still drawn from the address it had
                expect(byTestId("artifactOpenJustYouOnly")).toBeNull();
                expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
            }
        );

        it("says so, and saves nothing else, when it cannot be had in the chat it was made in", async () => {
            api.fetchArtifact.mockResolvedValue(opened(3));
            api.shareArtifact.mockRejectedValue(new api.ArtifactRequestError(503, "private_files_not_configured"));
            mountWindow(3);
            await openShareMenu();
            byTestId("artifactOpenMe")?.click();
            await vi.waitFor(() => expect(byTestId("artifactShareFailed")).not.toBeNull());
            expect(api.shareArtifact).toHaveBeenCalledTimes(1);
            expect(byTestId("artifactOpenMe")?.getAttribute("aria-checked")).toBe("false");
            expect(byTestId("artifactOpenChat")?.getAttribute("aria-checked")).toBe("true");
        });

        it("tells someone in its chat that its owner keeps it private, with nothing to try again", async () => {
            api.fetchArtifact.mockRejectedValue(new api.ArtifactRequestError(404, "kept_private"));
            mountWindow(3);
            await vi.waitFor(() => expect(byTestId("artifactFailed")).not.toBeNull());
            expect(byTestId("artifactFailed")?.getAttribute("data-failure")).toBe("private");
            expect(byTestId("artifactFailed")?.querySelector("button")).toBeNull();
            expect(byTestId("artifactFrame")).toBeNull();
            expect(byTestId("artifactVersions")).toBeNull();
        });

        it("puts away what was showing once it hears its owner made it private", async () => {
            api.fetchArtifact.mockResolvedValue(opened(3, 3, "app", false));
            const website = mountWindow(3);
            await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());

            api.fetchArtifact.mockRejectedValue(new api.ArtifactRequestError(404, "kept_private"));
            website.version.set(1);
            await vi.waitFor(() => expect(byTestId("artifactFailed")).not.toBeNull());
            expect(byTestId("artifactFailed")?.getAttribute("data-failure")).toBe("private");
            expect(byTestId("artifactFrame")).toBeNull();
            expect(byTestId("artifactSwitchFailed")).toBeNull();
        });

        it("draws nothing where there is no address, and never from anywhere else", async () => {
            const answer = shared("me");
            api.fetchArtifact.mockResolvedValue({ ...answer, version: { ...answer.version, url: null } });
            mountWindow(3);
            await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());
            expect(byTestId("artifactFrame")).toBeNull();
            expect(target.querySelector("img")).toBeNull();
        });

        it("opens a page with songs or pictures beside it again just before its address stops", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000, true));
            mountWindow(3);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));
            expect(api.fetchArtifact).toHaveBeenCalledTimes(1);

            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS2", 600_000, true));
            // A minute before a life of ten: not yet at eight
            await vi.advanceTimersByTimeAsync(480_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(61_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(2);
            expect(api.fetchArtifact).toHaveBeenLastCalledWith(ID, { kind: "nearby", ref: "bubble" }, 3);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS2/3/index.html"));
            // The buttons never left: it is the same version, at a new address
            expect(byTestId("artifactVersions")).not.toBeNull();

            // And again before the new one stops
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS3", 600_000, true));
            await vi.advanceTimersByTimeAsync(541_000);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS3/3/index.html"));
            expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
        });

        it("tries again when the new address cannot be fetched, and puts the page away when it is gone by then", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000, true));
            mountWindow(3);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));

            api.fetchArtifact.mockRejectedValue(new api.ArtifactRequestError(0, "offline"));
            await vi.advanceTimersByTimeAsync(541_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(2);
            // What is showing stays while it is tried again
            expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html");
            expect(byTestId("artifactFailed")).toBeNull();

            api.fetchArtifact.mockRejectedValue(new api.ArtifactRequestError(404, "not_found"));
            await vi.advanceTimersByTimeAsync(31_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
            await vi.waitFor(() => expect(byTestId("artifactFailed")).not.toBeNull());
            expect(byTestId("artifactFailed")?.getAttribute("data-failure")).toBe("gone");
            expect(byTestId("artifactFrame")).toBeNull();
            // Nothing more is asked for
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
        });

        it("leaves a page with nothing beside it alone, and opens it again only when its frame is drawn again later", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000));
            api.fetchArtifactCode.mockResolvedValue({
                version: openedPrivately("PASS1", 600_000).version,
                content: "x",
            });
            mountWindow(3);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));

            // Drawn again while its address works: nothing is asked for
            byTestId("artifactFrame")?.dispatchEvent(new Event("load"));
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
            expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html");

            // Back from the Code view the game draws it again itself: from a new address, and from nowhere meanwhile
            let fetched: (answer: unknown) => void = () => {};
            api.fetchArtifact.mockReturnValue(
                new Promise((resolve) => {
                    fetched = resolve;
                })
            );
            byTestId("artifactCode")?.click();
            await vi.waitFor(() => expect(byTestId("artifactCodeView")).not.toBeNull());
            byTestId("artifactCode")?.click();
            await vi.waitFor(() => expect(byTestId("artifactCodeView")).toBeNull());
            expect(api.fetchArtifact).toHaveBeenCalledTimes(2);
            expect(byTestId("artifactFrame")).toBeNull();
            fetched(openedPrivately("PASS2", 600_000));
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS2/3/index.html"));

            // The browser draws the frame again after that one stopped too
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS3", 600_000));
            await vi.advanceTimersByTimeAsync(601_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(2);
            byTestId("artifactFrame")?.dispatchEvent(new Event("load"));
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS3/3/index.html"));
            expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
        });

        it("draws a private page from a new address when it comes back from the Code view, even while the old one works", async () => {
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000, true));
            api.fetchArtifactCode.mockResolvedValue({
                version: { ...openedPrivately("PASS1", 600_000).version, url: null },
                content: "x",
            });
            mountWindow(3);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));

            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS2", 600_000, true));
            byTestId("artifactCode")?.click();
            await vi.waitFor(() => expect(byTestId("artifactCodeView")).not.toBeNull());
            // Going to the Code view asks for no address
            expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
            byTestId("artifactCode")?.click();
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS2/3/index.html"));
            expect(api.fetchArtifact).toHaveBeenCalledTimes(2);
            expect(api.fetchArtifact).toHaveBeenLastCalledWith(ID, { kind: "nearby", ref: "bubble" }, 3);
        });

        it("draws one that is not private from the address it has, back from the Code view", async () => {
            api.fetchArtifact.mockResolvedValue(shared("chat"));
            api.fetchArtifactCode.mockResolvedValue({ version: shared("chat").version, content: "x" });
            mountWindow(3);
            await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());
            const address = srcOfFrame();

            byTestId("artifactCode")?.click();
            await vi.waitFor(() => expect(byTestId("artifactCodeView")).not.toBeNull());
            byTestId("artifactCode")?.click();
            await vi.waitFor(() => expect(srcOfFrame()).toBe(address));
            expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
        });

        it("asks for nothing more once the window is closed", async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
            api.fetchArtifact.mockResolvedValue(openedPrivately("PASS1", 600_000, true));
            mountWindow(3);
            await vi.waitFor(() => expect(srcOfFrame()).toBe("https://orbit.test/af/PASS1/3/index.html"));
            component?.$destroy();
            component = undefined;
            await vi.advanceTimersByTimeAsync(3_600_000);
            expect(api.fetchArtifact).toHaveBeenCalledTimes(1);
        });
    });

    it("shows no Share button to someone who is not the owner", async () => {
        api.fetchArtifact.mockResolvedValue(opened(3, 3, "app", false));
        mountWindow(3);
        await vi.waitFor(() => expect(byTestId("artifactVersions")).not.toBeNull());
        expect(byTestId("artifactShare")).toBeNull();
    });

    it("says it is gone for a missing artifact, and offers another try only when the server cannot be reached", async () => {
        api.fetchArtifact.mockRejectedValue(new api.ArtifactRequestError(404, "not_found"));
        mountWindow(1);
        await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
        expect(document.querySelector('[role="alert"] button')).toBeNull();
        component?.$destroy();

        api.fetchArtifact.mockRejectedValueOnce(new api.ArtifactRequestError(0, "offline"));
        api.fetchArtifact.mockResolvedValueOnce(opened(1, 1));
        mountWindow(1);
        await vi.waitFor(() => expect(document.querySelector('[role="alert"] button')).not.toBeNull());
        document.querySelector<HTMLButtonElement>('[role="alert"] button')?.click();
        await vi.waitFor(() => expect(byTestId("artifactFrame")).not.toBeNull());
        expect(api.fetchArtifact).toHaveBeenCalledTimes(3);
    });
});
