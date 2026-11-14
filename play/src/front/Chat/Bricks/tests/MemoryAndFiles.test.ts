import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The person's own Bricks, as the chat knows them: undefined until Orbit has answered
const bricks = vi.hoisted(() => ({
    subscribers: new Set<(value: unknown) => void>(),
    value: undefined as { id: string }[] | undefined,
}));
const game = vi.hoisted(() => ({
    getMyMemory: vi.fn<(botId: string) => Promise<unknown>>(),
    forgetMyMemory: vi.fn<(botId: string, what: unknown) => Promise<unknown>>(),
    getBrickFiles: vi.fn<(brickId: string) => Promise<unknown>>(),
    deleteBrickFile: vi.fn<(brickId: string, fileId: string) => Promise<unknown>>(),
    closeModal: vi.fn<() => void>(),
    warn: vi.fn<(message: string) => void>(),
    openYourArtifacts: vi.fn<() => void>(),
    zip: vi.fn<() => Promise<{ added: number; missed: number } | undefined>>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the groups read on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("svelte-modals", () => ({ closeModal: game.closeModal }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        getMyMemory: game.getMyMemory,
        forgetMyMemory: game.forgetMyMemory,
        getBrickFiles: game.getBrickFiles,
        deleteBrickFile: game.deleteBrickFile,
    },
}));
vi.mock("../MyBricksStore", () => ({
    myBricksStore: {
        subscribe: (run: (value: unknown) => void) => {
            bricks.subscribers.add(run);
            run(bricks.value);
            return () => bricks.subscribers.delete(run);
        },
    },
}));
vi.mock("../BrickFiles", async (original) => ({
    ...(await original<Record<string, unknown>>()),
    downloadEverything: game.zip,
}));
vi.mock("../../../Enum/EnvironmentVariable", () => ({ UPLOADER_URL: "http://uploader.test" }));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));
vi.mock("../../../Artifacts/openYourArtifacts", () => ({ openYourArtifacts: game.openYourArtifacts }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import BrickFilesGroup from "../BrickFilesGroup.svelte";
import BrickMemoryGroup from "../BrickMemoryGroup.svelte";
import MemorySheet from "../MemorySheet.svelte";

const BOT = "0b7c1d2e-1111-4222-8333-944455556666";
const thing = (id: string, value: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: "pref",
    value,
    label: null,
    at: Date.parse("2026-11-06T10:00:00.000Z"),
    private: false,
    ...over,
});
const FIVE = [
    thing("k1", "lo-fi", { private: true }),
    thing("k2", "jazz"),
    thing("k3", "rain"),
    thing("k4", "tea"),
    thing("k5", "walks"),
];
const file = (over: Record<string, unknown> = {}) => ({
    id: "f1",
    name: "visa-receipt.pdf",
    kind: "file",
    sizeBytes: 212 * 1024,
    at: "2026-11-10T08:00:00.000Z",
    audience: "you",
    store: { bucket: "user-refs", fileId: "8d1c1c5e-0d6e-4a3c-9a6b-3f0d6f0e1111.pdf" },
    ...over,
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

describe("Memory and Files on a Brick's page (#2003)", () => {
    let target: HTMLElement;
    let part: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        bricks.value = [];
        game.getMyMemory.mockResolvedValue({ items: FIVE });
        game.forgetMyMemory.mockResolvedValue({ forgotten: 1 });
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        part?.$destroy();
        part = undefined;
        target.remove();
    });

    const byId = <T extends HTMLElement = HTMLElement>(id: string) => target.querySelector<T>(`[data-testid="${id}"]`);
    const all = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const rowsText = (id: string) => all(id).map((row) => row.textContent?.replace(/\s+/g, " ").trim());

    describe("Memory", () => {
        async function openGroup(props: Record<string, unknown> = {}) {
            part = new BrickMemoryGroup({
                target,
                props: { botId: BOT, name: "Brick", open: true, onToggle: () => undefined, ...props },
            });
            await settle();
        }

        it("says how many things it remembers, shows the first four with their words and Forget, and keeps the rest behind See all", async () => {
            await openGroup();
            expect(game.getMyMemory).toHaveBeenCalledWith(BOT);
            expect(byId("bot-page-group-memory")?.textContent).toContain("Memory");
            expect(byId("bot-page-group-memory")?.textContent).toContain("5 things about you");
            expect(text()).toContain(
                "What Brick remembers about you, from your chats with it. Only you see this list."
            );
            expect(rowsText("memoryRow")).toEqual([
                "Likes lo-fi Said privately · kept out of group chats Forget",
                "Likes jazz From a chat on 6 Nov Forget",
                "Likes rain From a chat on 6 Nov Forget",
                "Likes tea From a chat on 6 Nov Forget",
            ]);
            expect(byId("memorySeeAll")?.textContent).toContain("See all 5");
            expect(text()).toContain("You can also just say “forget that” in its chat.");
            byId("memorySeeAll")?.click();
            await tick();
            expect(all("memoryRow")).toHaveLength(5);
            expect(byId("memorySeeAll")).toBeNull();
        });

        it("forgets a thing with one tap, by its key, and it is gone from the list", async () => {
            await openGroup();
            all("memoryForget")[1].click();
            await settle();
            expect(game.forgetMyMemory).toHaveBeenCalledWith(BOT, { itemId: "k2" });
            expect(rowsText("memoryRow").join(" ")).not.toContain("jazz");
            expect(byId("bot-page-group-memory")?.textContent).toContain("4 things about you");
        });

        it("says so, and keeps the thing, when Orbit refuses", async () => {
            game.forgetMyMemory.mockRejectedValue(new Error("offline"));
            await openGroup();
            all("memoryForget")[0].click();
            await settle();
            expect(game.warn).toHaveBeenCalledWith("Couldn't forget that. Try again.");
            expect(all("memoryRow")).toHaveLength(4);
            expect(rowsText("memoryRow")[0]).toContain("lo-fi");
        });

        it("asks once before forgetting everything, says what stays, then starts fresh", async () => {
            await openGroup();
            expect(byId("memoryForgetEverything")?.textContent).toContain("Forget everything");
            expect(text()).toContain("Brick starts fresh with you. Your chats and files stay.");
            byId("memoryForgetEverything")?.click();
            await tick();
            expect(game.forgetMyMemory).not.toHaveBeenCalled();
            byId("memoryKeep")?.click();
            await tick();
            expect(byId("memoryForgetEverything")).not.toBeNull();
            byId("memoryForgetEverything")?.click();
            await tick();
            byId("memoryForgetEverythingConfirm")?.click();
            await settle();
            expect(game.forgetMyMemory).toHaveBeenCalledWith(BOT, { everything: true });
            expect(byId("memoryEmpty")?.textContent).toContain("doesn't remember anything about you yet");
            expect(byId("bot-page-group-memory")?.textContent).toContain("Nothing yet");
        });

        it("says when it could not read the list, and reads again on Try again", async () => {
            game.getMyMemory.mockRejectedValueOnce(new Error("offline"));
            await openGroup();
            expect(text()).toContain("Couldn't read what Brick remembers. Try again.");
            expect(all("memoryRow")).toHaveLength(0);
            byId("memoryRetry")?.click();
            await settle();
            expect(all("memoryRow")).toHaveLength(4);
        });
    });

    describe("the sheet from a bot's chat menu", () => {
        async function openSheet(props: Record<string, unknown> = {}) {
            part = new MemorySheet({
                target,
                props: { isOpen: true, botId: BOT, name: "Melody", owner: "Omar", ...props },
                intro: false,
            });
            await settle();
        }

        it("shows the same list for someone else's bot and says its maker cannot see it", async () => {
            await openSheet();
            expect(byId("memorySheet")?.textContent).toContain("What Melody remembers about you");
            expect(text()).toContain("Only you see this. Omar, who made Melody, can't.");
            expect(all("memoryRow")).toHaveLength(5);
            all("memoryForget")[0].click();
            await settle();
            expect(game.forgetMyMemory).toHaveBeenCalledWith(BOT, { itemId: "k1" });
            expect(all("memoryRow")).toHaveLength(4);
        });

        it("does not name a maker it does not know, and a Brick of your own needs none", async () => {
            await openSheet({ owner: undefined });
            expect(text()).toContain("Only you see this. Whoever made Melody can't.");
            part?.$destroy();
            await openSheet({ owner: undefined, own: true });
            expect(text()).toContain("Only you see this.");
            expect(text()).not.toContain("Whoever made");
        });

        it("knows a Brick of your own from the person's Bricks, and says nothing about a maker while they are still loading", async () => {
            bricks.value = [{ id: BOT }];
            await openSheet({ owner: "Omar" });
            expect(text()).toContain("Only you see this.");
            expect(text()).not.toContain("who made");
            part?.$destroy();
            // Not read yet: it cannot tell whose bot this is, so it claims neither
            bricks.value = undefined;
            await openSheet({ owner: undefined });
            expect(text()).toContain("Only you see this.");
            expect(text()).not.toContain("Whoever made");
        });

        it("closes with Done", async () => {
            await openSheet();
            byId("memoryDone")?.click();
            expect(game.closeModal).toHaveBeenCalled();
        });

        it("forgets everything after one more tap", async () => {
            await openSheet();
            byId("memoryForgetEverything")?.click();
            await tick();
            byId("memoryForgetEverythingConfirm")?.click();
            await settle();
            expect(game.forgetMyMemory).toHaveBeenCalledWith(BOT, { everything: true });
            expect(byId("memoryEmpty")).not.toBeNull();
            expect(byId("memoryForgetEverything")).toBeNull();
        });
    });

    describe("Files", () => {
        const answer = (over: Record<string, unknown> = {}) => ({
            made: {
                files: [file(), file({ id: "f3", name: "bakery-spending-2026.xlsx", sizeBytes: 48 * 1024 })],
                total: 6,
                artifacts: 4,
            },
            sent: {
                files: [
                    file({ id: "f2", name: "passport-and-ticket.pdf", sizeBytes: 1.4 * 1024 * 1024, audience: "you" }),
                ],
                total: 1,
            },
            computer: null,
            count: 3,
            bytes: 1.5 * 1024 * 1024,
            ...over,
        });
        async function openGroup(props: Record<string, unknown> = {}) {
            part = new BrickFilesGroup({
                target,
                props: { brickId: BOT, name: "Brick", open: true, onToggle: () => undefined, ...props },
            });
            await settle();
        }

        it("shows what it made, what was sent to it and how it was shared, as in the mock", async () => {
            game.getBrickFiles.mockResolvedValue(answer());
            await openGroup();
            expect(game.getBrickFiles).toHaveBeenCalledWith(BOT);
            expect(byId("bot-page-group-files")?.textContent).toContain("3 files · 1.5 MB");
            expect(rowsText("filesMadeRow")).toEqual([
                "visa-receipt.pdf 10 Nov · 212 KB Download",
                "bakery-spending-2026.xlsx 10 Nov · 48 KB Download",
            ]);
            expect(rowsText("filesSentRow")).toEqual([
                "passport-and-ticket.pdf 10 Nov · 1.4 MB · only Brick and you Download Delete",
            ]);
            expect(byId("filesAllMade")?.textContent).toContain("All 6 things it made");
            expect(byId("filesAllMade")?.textContent).toContain("Opens Your artifacts");
            expect(byId("filesDownloadAll")).not.toBeNull();
            byId("filesAllMade")?.click();
            expect(game.openYourArtifacts).toHaveBeenCalledTimes(1);
        });

        it("offers one sent file to download on its own row, as a made file has", async () => {
            game.getBrickFiles.mockResolvedValue(answer());
            await openGroup();
            expect(all("filesSentDownload")).toHaveLength(1);
        });

        it("says so when the zip is missing some of the files, and when it is whole stays quiet", async () => {
            game.getBrickFiles.mockResolvedValue(answer());
            await openGroup();
            game.zip.mockResolvedValueOnce({ added: 2, missed: 1 });
            byId("filesDownloadAll")?.click();
            await settle();
            expect(game.warn).toHaveBeenCalledWith(
                "Some files couldn't be added to the download. Try again to get them."
            );
            game.warn.mockClear();
            game.zip.mockResolvedValueOnce({ added: 3, missed: 0 });
            byId("filesDownloadAll")?.click();
            await settle();
            expect(game.warn).not.toHaveBeenCalled();
        });

        it("says a file sent in a nearby chat was sent in a nearby chat", async () => {
            game.getBrickFiles.mockResolvedValue(
                answer({ sent: { files: [file({ id: "f2", name: "plan.pdf", audience: "chat" })], total: 1 } })
            );
            await openGroup();
            expect(rowsText("filesSentRow")[0]).toContain("sent in a nearby chat");
            expect(rowsText("filesSentRow")[0]).not.toContain("only Brick and you");
        });

        it("deletes a file the person sent, and nothing else is offered for deleting", async () => {
            game.getBrickFiles.mockResolvedValue(answer());
            game.deleteBrickFile.mockResolvedValue({ deleted: true });
            await openGroup();
            expect(all("filesDelete")).toHaveLength(1);
            all("filesDelete")[0].click();
            await settle();
            expect(game.deleteBrickFile).toHaveBeenCalledWith(BOT, "f2");
            expect(all("filesSentRow")).toHaveLength(0);
            expect(byId("filesNoneSent")?.textContent).toContain("Files you send Brick show up here.");
        });

        it("says so, and keeps the file, when Orbit refuses", async () => {
            game.getBrickFiles.mockResolvedValue(answer());
            game.deleteBrickFile.mockRejectedValue(new Error("offline"));
            await openGroup();
            all("filesDelete")[0].click();
            await settle();
            expect(game.warn).toHaveBeenCalledWith("Couldn't delete the file. Try again.");
            expect(all("filesSentRow")).toHaveLength(1);
        });

        it("is plain when nothing is there yet, and offers no download of nothing", async () => {
            game.getBrickFiles.mockResolvedValue({
                made: { files: [], total: 0, artifacts: 0 },
                sent: { files: [], total: 0 },
                computer: null,
                count: 0,
                bytes: 0,
            });
            await openGroup();
            expect(byId("bot-page-group-files")?.textContent).toContain("Nothing yet");
            expect(byId("filesNoneMade")?.textContent).toContain("Nothing made for you yet");
            expect(byId("filesDownloadAll")).toBeNull();
            expect(byId("filesAllMade")).toBeNull();
        });

        it("shows nothing about a computer until it has one", async () => {
            game.getBrickFiles.mockResolvedValue(answer());
            await openGroup();
            expect(text()).not.toContain("computer");
        });

        it("with the computer off, shows the last saved copy with its date and never offers to turn it on", async () => {
            game.getBrickFiles.mockResolvedValue(
                answer({
                    computer: { state: "off", files: 9, bytes: 1.2 * 1024 ** 3, savedAt: "2026-11-09T10:00:00.000Z" },
                })
            );
            await openGroup();
            expect(text()).toContain("From its computer, which is off");
            expect(byId("filesLastCopy")?.textContent).toContain("Last saved copy");
            expect(byId("filesLastCopy")?.textContent).toContain("9 Nov · 1.2 GB");
            expect(text()).toContain("Looking here never turns the computer on.");
            expect(byId("filesBrowse")).toBeNull();
        });

        it("with the computer on, browses its files only where the page can open them", async () => {
            game.getBrickFiles.mockResolvedValue(
                answer({ computer: { state: "on", files: 9, bytes: 1.2 * 1024 ** 3, savedAt: null } })
            );
            await openGroup();
            expect(byId("filesBrowse")).toBeNull();
            part?.$destroy();
            const onBrowse = vi.fn();
            await openGroup({ onBrowse });
            byId("filesBrowse")?.click();
            expect(onBrowse).toHaveBeenCalledTimes(1);
        });

        it("says when it could not read the files, and reads again on Try again", async () => {
            game.getBrickFiles.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(answer());
            await openGroup();
            expect(text()).toContain("Couldn't read the files. Try again.");
            byId("filesRetry")?.click();
            await settle();
            expect(all("filesMadeRow")).toHaveLength(2);
        });
    });
});
