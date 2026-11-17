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
    getBrickFilesPage:
        vi.fn<
            (
                brickId: string,
                page: { section: "made" | "sent"; cursor?: string | null; search?: string }
            ) => Promise<unknown>
        >(),
    deleteBrickFile: vi.fn<(brickId: string, fileId: string) => Promise<unknown>>(),
    closeModal: vi.fn<() => void>(),
    warn: vi.fn<(message: string) => void>(),
    openYourArtifacts: vi.fn<() => void>(),
    zip: vi.fn<(source: unknown) => Promise<{ added: number; missed: number; complete: boolean } | undefined>>(),
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
        getBrickFilesPage: game.getBrickFilesPage,
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
                fileTotal: 2,
                nextCursor: null,
            },
            sent: {
                files: [
                    file({ id: "f2", name: "passport-and-ticket.pdf", sizeBytes: 1.4 * 1024 * 1024, audience: "you" }),
                ],
                total: 1,
                nextCursor: null,
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
            expect(byId("filesAllMade")?.textContent).toContain("4 artifacts it made");
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
            game.zip.mockResolvedValueOnce({ added: 2, missed: 1, complete: true });
            byId("filesDownloadAll")?.click();
            await settle();
            expect(game.warn).toHaveBeenCalledWith(
                "Some files couldn't be added to the download. Try again to get them."
            );
            game.warn.mockClear();
            game.zip.mockResolvedValueOnce({ added: 3, missed: 0, complete: true });
            byId("filesDownloadAll")?.click();
            await settle();
            expect(game.warn).not.toHaveBeenCalled();
            // The list stopped coming part of the way: the zip is not the whole of it, and that is said apart
            game.zip.mockResolvedValueOnce({ added: 3, missed: 0, complete: false });
            byId("filesDownloadAll")?.click();
            await settle();
            expect(game.warn).toHaveBeenCalledWith(
                "Couldn't read the whole list of files, so the download is missing some. Try again to get all of them."
            );
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
                made: { files: [], total: 0, artifacts: 0, fileTotal: 0, nextCursor: null },
                sent: { files: [], total: 0, nextCursor: null },
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

        describe("more than the first look", () => {
            const sentFile = (n: number) => file({ id: `s${n}`, name: `sent-${n}.pdf`, sizeBytes: 10 });
            const sentPage = (from: number, to: number) =>
                Array.from({ length: to - from + 1 }, (_, index) => sentFile(from + index));
            const longAnswer = () =>
                answer({
                    made: {
                        files: [file({ id: "m1", name: "made-1.pdf" }), file({ id: "m2", name: "made-2.pdf" })],
                        total: 8,
                        artifacts: 1,
                        fileTotal: 7,
                        nextCursor: "made-next",
                    },
                    sent: { files: sentPage(1, 50), total: 130, nextCursor: "sent-next" },
                    count: 137,
                    bytes: 1370,
                });
            const typeInSearch = async (words: string) => {
                const input = byId<HTMLInputElement>("filesSearchInput");
                if (!input) throw new Error("no search");
                input.value = words;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                // The search goes out when typing pauses
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 400);
                });
                await settle();
            };

            it("offers the rest of a long list on a button, with how many more there are, and adds the next page below", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                await openGroup();
                expect(all("filesSentRow")).toHaveLength(50);
                expect(byId("filesMoreSent")?.textContent).toContain("Show older files");
                expect(byId("filesMoreSent")?.textContent).toContain("80 more");
                expect(byId("filesMoreMade")?.textContent).toContain("5 more");
                game.getBrickFilesPage.mockResolvedValueOnce({
                    section: "sent",
                    files: sentPage(51, 100),
                    total: 130,
                    nextCursor: "sent-last",
                });
                byId("filesMoreSentButton")?.click();
                await settle();
                expect(game.getBrickFilesPage).toHaveBeenCalledWith(BOT, {
                    section: "sent",
                    cursor: "sent-next",
                    search: undefined,
                });
                expect(all("filesSentRow")).toHaveLength(100);
                expect(byId("filesMoreSent")?.textContent).toContain("30 more");
                game.getBrickFilesPage.mockResolvedValueOnce({
                    section: "sent",
                    files: sentPage(101, 130),
                    total: 130,
                    nextCursor: null,
                });
                byId("filesMoreSentButton")?.click();
                await settle();
                expect(all("filesSentRow")).toHaveLength(130);
                expect(byId("filesMoreSent")).toBeNull();
                expect(rowsText("filesSentRow")[129]).toContain("sent-130.pdf");
            });

            it("shows more of what it made without leaving the list, and keeps the artifacts one tap away apart", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                await openGroup();
                game.getBrickFilesPage.mockResolvedValueOnce({
                    section: "made",
                    files: [file({ id: "m3", name: "made-3.pdf" })],
                    total: 7,
                    nextCursor: "made-last",
                });
                byId("filesMoreMadeButton")?.click();
                await settle();
                expect(rowsText("filesMadeRow")).toHaveLength(3);
                expect(byId("filesMoreMade")?.textContent).toContain("4 more");
                expect(byId("filesAllMade")?.textContent).toContain("1 artifact it made");
                byId("filesAllMade")?.click();
                expect(game.openYourArtifacts).toHaveBeenCalledTimes(1);
            });

            it("says so, and keeps the button, when more could not be read", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                game.getBrickFilesPage.mockRejectedValueOnce(new Error("offline"));
                await openGroup();
                byId("filesMoreSentButton")?.click();
                await settle();
                expect(game.warn).toHaveBeenCalledWith("Couldn't read more files. Try again.");
                expect(all("filesSentRow")).toHaveLength(50);
                expect(byId("filesMoreSentButton")).not.toBeNull();
            });

            it("offers a search only once a list is longer than what it shows", async () => {
                game.getBrickFiles.mockResolvedValue(answer());
                await openGroup();
                expect(byId("filesSearch")).toBeNull();
                part?.$destroy();
                target.innerHTML = "";
                game.getBrickFiles.mockResolvedValue(longAnswer());
                await openGroup();
                expect(byId("filesSearch")).not.toBeNull();
            });

            it("searches every file by name, not only the ones shown, and says how many it found", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                game.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve(
                        asked.section === "made"
                            ? { section: "made", files: [], total: 0, nextCursor: null }
                            : { section: "sent", files: [sentFile(120)], total: 1, nextCursor: null }
                    )
                );
                await openGroup();
                await typeInSearch("sent-120");
                expect(game.getBrickFilesPage).toHaveBeenCalledWith(BOT, { section: "sent", search: "sent-120" });
                expect(rowsText("filesSentRow")).toEqual([expect.stringContaining("sent-120.pdf")]);
                expect(byId("filesFound")?.textContent).toContain("1 file named like “sent-120”");
                // What it made has nothing under these words, so that list is not shown empty
                expect(all("filesMadeRow")).toHaveLength(0);
                expect(byId("filesNoneMade")).toBeNull();
                expect(byId("filesAllMade")).toBeNull();
                // Nothing here is the computer's or the whole of the Brick's: the download is of what was found
                expect(byId("filesDownloadAll")?.textContent).toContain("Download the 1 found");
                expect(text()).toContain("One zip with only the files found by this search.");
                // Clearing it brings back the newest
                await typeInSearch("");
                expect(all("filesSentRow")).toHaveLength(50);
                expect(byId("filesDownloadAll")?.textContent).toContain("Download all 137 files");
            });

            it("says so when nothing is named like the words, and when the search could not be made", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                game.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve({ section: asked.section, files: [], total: 0, nextCursor: null })
                );
                await openGroup();
                await typeInSearch("zzz");
                expect(byId("filesFound")?.textContent).toContain("No file is named like “zzz”.");
                expect(byId("filesDownloadAll")).toBeNull();
                game.getBrickFilesPage.mockRejectedValue(new Error("offline"));
                await typeInSearch("yyy");
                expect(text()).toContain("Couldn't search. Try again.");
                expect(all("filesSentRow")).toHaveLength(0);
                game.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve({ section: asked.section, files: [], total: 0, nextCursor: null })
                );
                byId("filesSearchRetry")?.click();
                await settle();
                expect(byId("filesFound")?.textContent).toContain("No file is named like “yyy”.");
            });

            it("downloads every file of both lists, a page at a time, and not only the ones shown", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                game.getBrickFilesPage.mockImplementation((_id, asked) => {
                    if (asked.section === "made")
                        return Promise.resolve({
                            section: "made",
                            files: [file({ id: "m1" })],
                            total: 1,
                            nextCursor: null,
                        });
                    return Promise.resolve(
                        asked.cursor
                            ? { section: "sent", files: sentPage(51, 130), total: 130, nextCursor: null }
                            : { section: "sent", files: sentPage(1, 50), total: 130, nextCursor: "p2" }
                    );
                });
                const read: string[] = [];
                game.zip.mockImplementation(async (source) => {
                    for await (const files of source as AsyncIterable<{ id: string }[]>)
                        read.push(...files.map((one) => one.id));
                    return { added: read.length, missed: 0, complete: true };
                });
                await openGroup();
                expect(byId("filesDownloadAll")?.textContent).toContain("Download all 137 files");
                expect(text()).toContain("not only the ones shown");
                byId("filesDownloadAll")?.click();
                await settle();
                expect(read).toHaveLength(1 + 130);
                expect(read[0]).toBe("m1");
                expect(read[130]).toBe("s130");
                expect(game.warn).not.toHaveBeenCalled();
            });

            it("says the download is missing files when the list stopped coming", async () => {
                game.getBrickFiles.mockResolvedValue(longAnswer());
                game.getBrickFilesPage.mockRejectedValue(new Error("offline"));
                game.zip.mockImplementation(async (source) => {
                    try {
                        for await (const files of source as AsyncIterable<unknown[]>) void files;
                    } catch {
                        return { added: 4, missed: 0, complete: false };
                    }
                    return { added: 4, missed: 0, complete: true };
                });
                await openGroup();
                byId("filesDownloadAll")?.click();
                await settle();
                expect(game.warn).toHaveBeenCalledWith(
                    "Couldn't read the whole list of files, so the download is missing some. Try again to get all of them."
                );
            });

            it("says the artifacts and a computer's files are not in the download", async () => {
                game.getBrickFiles.mockResolvedValue(answer());
                await openGroup();
                expect(text()).toContain("Your artifacts are separate.");
                part?.$destroy();
                target.innerHTML = "";
                game.getBrickFiles.mockResolvedValue(
                    answer({ computer: { state: "off", files: 9, bytes: 1024, savedAt: null } })
                );
                await openGroup();
                expect(text()).toContain("Your artifacts and the files on its computer are separate.");
            });
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
