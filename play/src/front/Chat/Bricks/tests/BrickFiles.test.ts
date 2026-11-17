import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const orbit = vi.hoisted(() => ({
    getBrickFiles: vi.fn<(brickId: string) => Promise<unknown>>(),
    getBrickFilesPage:
        vi.fn<
            (
                brickId: string,
                page: { section: "made" | "sent"; cursor?: string | null; search?: string }
            ) => Promise<unknown>
        >(),
    deleteBrickFile: vi.fn<(brickId: string, fileId: string) => Promise<unknown>>(),
}));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: orbit }));
vi.mock("../../../Enum/EnvironmentVariable", () => ({ UPLOADER_URL: "http://uploader.test/" }));

import {
    brickFilesList,
    downloadEverything,
    downloadFile,
    fileIconKind,
    fileLink,
    fileSize,
    parseBrickFiles,
    parseBrickFilesPage,
    zipNames,
} from "../BrickFiles";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
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
const answer = (over: Record<string, unknown> = {}) => ({
    made: { files: [file()], total: 6, artifacts: 4, fileTotal: 2, nextCursor: null },
    sent: { files: [file({ id: "f2", name: "passport.pdf", audience: "chat" })], total: 1, nextCursor: null },
    computer: null,
    count: 3,
    bytes: 1000,
    ...over,
});

describe("a Brick's files (#2003)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    describe("reading Orbit's answer", () => {
        it("reads the files, how it was shared, the totals and the computer", () => {
            const read = parseBrickFiles(
                answer({
                    computer: { state: "off", files: 9, bytes: 1_200_000_000, savedAt: "2026-11-09T10:00:00.000Z" },
                })
            );
            expect(read.made.files[0]).toMatchObject({
                name: "visa-receipt.pdf",
                audience: "you",
                sizeBytes: 212 * 1024,
            });
            expect(read.made).toMatchObject({ total: 6, artifacts: 4 });
            expect(read.sent.files[0].audience).toBe("chat");
            expect(read.count).toBe(3);
            expect(read.computer).toEqual({
                state: "off",
                files: 9,
                bytes: 1_200_000_000,
                savedAt: Date.parse("2026-11-09T10:00:00.000Z"),
            });
        });

        it("leaves out a file that is not whole, and has no computer until Orbit says so", () => {
            const read = parseBrickFiles(
                answer({
                    made: {
                        files: [file(), file({ id: "" }), file({ store: {} }), file({ at: "soon" })],
                        total: 1,
                        artifacts: 0,
                    },
                })
            );
            expect(read.made.files.map((one) => one.id)).toEqual(["f1"]);
            expect(read.computer).toBeNull();
            expect(parseBrickFiles(undefined).count).toBe(0);
            expect(parseBrickFiles({ computer: { state: "dreaming" } }).computer).toBeNull();
        });
    });

    describe("reading a page and the place the next one starts", () => {
        it("reads how many files a list has and where its next page starts", () => {
            const read = parseBrickFiles(
                answer({
                    made: { files: [file()], total: 9, artifacts: 4, fileTotal: 5, nextCursor: "abc" },
                    sent: { files: [file({ id: "f2" })], total: 130, nextCursor: "def" },
                })
            );
            expect(read.made).toMatchObject({ total: 9, fileTotal: 5, nextCursor: "abc" });
            expect(read.sent).toMatchObject({ total: 130, nextCursor: "def" });
        });

        it("from an Orbit that does not page yet, takes the list as the whole of it", () => {
            const read = parseBrickFiles({
                made: { files: [file()], total: 3, artifacts: 2 },
                sent: { files: [file({ id: "f2" })], total: 1 },
                count: 2,
                bytes: 5,
            });
            expect(read.made).toMatchObject({ fileTotal: 1, nextCursor: null });
            expect(read.sent.nextCursor).toBeNull();
        });

        it("reads a page, and refuses an answer that is not the page asked for", () => {
            expect(
                parseBrickFilesPage(
                    { section: "sent", files: [file({ id: "f9" })], total: 70, nextCursor: "x" },
                    "sent"
                )
            ).toEqual({
                files: [expect.objectContaining({ id: "f9" })],
                total: 70,
                nextCursor: "x",
            });
            expect(
                parseBrickFilesPage({ section: "sent", files: [], total: 0, nextCursor: null }, "sent").nextCursor
            ).toBeNull();
            // The first look again (an Orbit that ignores the question) or the other list is never taken for a page
            expect(() => parseBrickFilesPage(answer(), "sent")).toThrow();
            expect(() => parseBrickFilesPage({ section: "made", files: [], total: 0 }, "sent")).toThrow();
            expect(() => parseBrickFilesPage(undefined, "sent")).toThrow();
        });
    });

    describe("words and links", () => {
        it("writes plain sizes", () => {
            expect(fileSize(0, "en-US")).toBe("0 B");
            expect(fileSize(2 * 1024, "en-US")).toBe("2 KB");
            expect(fileSize(212 * 1024, "en-US")).toBe("212 KB");
            expect(fileSize(1.4 * 1024 * 1024, "en-US")).toBe("1.4 MB");
            expect(fileSize(1.2 * 1024 ** 3, "en-US")).toBe("1.2 GB");
        });

        it("opens an uploader file through its lasting link and any other file through its own", () => {
            expect(fileLink({ bucket: "user-refs", fileId: "a b.pdf" })).toBe(
                "http://uploader.test/chat-file/user-refs/a%20b.pdf"
            );
            expect(fileLink({ bucket: "b", fileId: "x" }, "")).toBeUndefined();
            expect(fileLink({ url: "https://example.com/a.pdf" })).toBe("https://example.com/a.pdf");
            expect(fileLink({ url: "javascript:alert(1)" })).toBeUndefined();
        });

        it("picks an icon by what the file is", () => {
            expect(fileIconKind({ name: "spend.xlsx", kind: "file" })).toBe("sheet");
            expect(fileIconKind({ name: "me.png", kind: "media" })).toBe("image");
            expect(fileIconKind({ name: "notes.pdf", kind: "file" })).toBe("file");
        });

        it("keeps every file in a zip, with a name each", () => {
            expect(zipNames(["a.pdf", "a.pdf", "b/c.txt", "A.pdf", ""])).toEqual([
                "a.pdf",
                "a (2).pdf",
                "b-c.txt",
                "A (3).pdf",
                "file",
            ]);
            // A name given out is never given again: the third "a.pdf" skips the file really called "a (2).pdf"
            const names = zipNames(["a.pdf", "a.pdf", "a (2).pdf"]);
            expect(names).toEqual(["a.pdf", "a (2).pdf", "a (2) (2).pdf"]);
            expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(3);
        });
    });

    describe("downloading", () => {
        it("starts one download from the file's own link, and changes nothing", () => {
            const click = vi.fn();
            const link: Record<string, unknown> = { click, remove: vi.fn() };
            const doc = { createElement: () => link, body: { appendChild: vi.fn() } } as unknown as Document;
            expect(downloadFile({ name: "visa.pdf", store: { bucket: "user-refs", fileId: "x.pdf" } }, doc)).toBe(true);
            expect(link).toMatchObject({
                href: "http://uploader.test/chat-file/user-refs/x.pdf",
                download: "visa.pdf",
                rel: "noopener",
            });
            expect(click).toHaveBeenCalledTimes(1);
            expect(downloadFile({ name: "x", store: { url: "ftp://x" } }, doc)).toBe(false);
        });

        it("puts the files of every page of a list in one zip, with a name each across pages, and says when the list was whole", async () => {
            const made: string[] = [];
            vi.stubGlobal("URL", { createObjectURL: () => "blob:zip", revokeObjectURL: vi.fn() });
            const click = vi
                .spyOn(HTMLAnchorElement.prototype, "click")
                .mockImplementation(function (this: HTMLAnchorElement) {
                    made.push(this.download);
                });
            const fetched: string[] = [];
            const fetcher = vi.fn((href: string) => {
                fetched.push(href);
                return Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) } as Response);
            });
            async function* pages() {
                await Promise.resolve();
                yield [{ name: "a.pdf", store: { bucket: "b", fileId: "1.pdf" } }];
                yield [
                    { name: "a.pdf", store: { bucket: "b", fileId: "2.pdf" } },
                    { name: "b.pdf", store: { bucket: "b", fileId: "3.pdf" } },
                ];
                yield [];
                yield [{ name: "c.pdf", store: { bucket: "b", fileId: "4.pdf" } }];
            }
            expect(await downloadEverything(pages(), "all.zip", fetcher as unknown as typeof fetch)).toEqual({
                added: 4,
                missed: 0,
                complete: true,
            });
            expect(fetched).toHaveLength(4);
            expect(made).toEqual(["all.zip"]);
            click.mockRestore();
            vi.unstubAllGlobals();
        });

        it("when the list stops coming part of the way, still gives what it read and says the zip is not whole", async () => {
            const made: string[] = [];
            vi.stubGlobal("URL", { createObjectURL: () => "blob:zip", revokeObjectURL: vi.fn() });
            const click = vi
                .spyOn(HTMLAnchorElement.prototype, "click")
                .mockImplementation(function (this: HTMLAnchorElement) {
                    made.push(this.download);
                });
            const fetcher = vi.fn(() =>
                Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) } as Response)
            );
            async function* cut() {
                await Promise.resolve();
                yield [
                    { name: "a.pdf", store: { bucket: "b", fileId: "1.pdf" } },
                    { name: "b.pdf", store: { bucket: "b", fileId: "2.pdf" } },
                ];
                throw new Error("offline");
            }
            expect(await downloadEverything(cut(), "all.zip", fetcher as unknown as typeof fetch)).toEqual({
                added: 2,
                missed: 0,
                complete: false,
            });
            expect(made).toEqual(["all.zip"]);
            // Nothing read before it stopped: no zip, and the caller is told it failed
            made.length = 0;
            async function* none() {
                await Promise.resolve();
                yield* [] as never[];
                throw new Error("offline");
            }
            expect(await downloadEverything(none(), "all.zip", fetcher as unknown as typeof fetch)).toBeUndefined();
            expect(made).toEqual([]);
            click.mockRestore();
            vi.unstubAllGlobals();
        });

        it("puts everything in one zip, and says what it could not read", async () => {
            const made: string[] = [];
            vi.stubGlobal("URL", { createObjectURL: () => "blob:zip", revokeObjectURL: vi.fn() });
            const click = vi
                .spyOn(HTMLAnchorElement.prototype, "click")
                .mockImplementation(function (this: HTMLAnchorElement) {
                    made.push(this.download);
                });
            const fetcher = vi.fn((href: string) =>
                Promise.resolve(
                    href.includes("bad")
                        ? ({ ok: false, status: 403 } as Response)
                        : ({ ok: true, blob: () => Promise.resolve(new Blob(["x"])) } as Response)
                )
            );
            const result = await downloadEverything(
                [
                    { name: "a.pdf", store: { bucket: "b", fileId: "good.pdf" } },
                    { name: "b.pdf", store: { bucket: "b", fileId: "bad.pdf" } },
                ],
                "Brick-files.zip",
                fetcher as unknown as typeof fetch
            );
            expect(result).toEqual({ added: 1, missed: 1, complete: true });
            expect(made).toEqual(["Brick-files.zip"]);
            expect(
                await downloadEverything(
                    [{ name: "b.pdf", store: { bucket: "b", fileId: "bad.pdf" } }],
                    "x.zip",
                    fetcher as unknown as typeof fetch
                )
            ).toBeUndefined();
            click.mockRestore();
            vi.unstubAllGlobals();
        });
    });

    describe("the list", () => {
        it("reads the files, and says so when it could not", async () => {
            orbit.getBrickFiles.mockResolvedValueOnce(answer());
            const list = brickFilesList(BRICK);
            await list.load();
            expect(orbit.getBrickFiles).toHaveBeenCalledWith(BRICK);
            expect(get(list.state)).toBe("ready");
            expect(get(list.files).sent.files).toHaveLength(1);
            orbit.getBrickFiles.mockRejectedValueOnce(new Error("offline"));
            await list.load();
            expect(get(list.state)).toBe("failed");
        });

        it("deletes a file the person sent, at once, and brings it back when Orbit refuses", async () => {
            orbit.getBrickFiles.mockResolvedValue(answer());
            orbit.deleteBrickFile.mockResolvedValueOnce({ deleted: true });
            const list = brickFilesList(BRICK);
            await list.load();
            const done = list.deleteSent("f2");
            expect(get(list.files).sent.files).toEqual([]);
            expect(await done).toBe(true);
            expect(orbit.deleteBrickFile).toHaveBeenCalledWith(BRICK, "f2");

            await list.load();
            orbit.deleteBrickFile.mockRejectedValueOnce(new Error("offline"));
            expect(await list.deleteSent("f2")).toBe(false);
            expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["f2"]);
        });

        it("brings back each file that fails to delete, in any order, and keeps one that is gone", async () => {
            orbit.getBrickFiles.mockResolvedValue(
                answer({
                    sent: {
                        files: [
                            file({ id: "f1", name: "a.pdf", sizeBytes: 100 }),
                            file({ id: "f2", name: "b.pdf", sizeBytes: 200 }),
                            file({ id: "f3", name: "c.pdf", sizeBytes: 300 }),
                        ],
                        total: 3,
                    },
                    count: 5,
                    bytes: 1000,
                })
            );
            const answers: { resolve: () => void; reject: (error: Error) => void }[] = [];
            orbit.deleteBrickFile.mockImplementation(
                () =>
                    new Promise((resolve, reject) => {
                        answers.push({ resolve: () => resolve({ deleted: true }), reject });
                    })
            );
            const list = brickFilesList(BRICK);
            await list.load();
            const first = list.deleteSent("f1");
            const second = list.deleteSent("f2");
            const third = list.deleteSent("f3");
            expect(get(list.files).sent.files).toEqual([]);
            expect(get(list.files)).toMatchObject({ count: 2, bytes: 400 });
            answers[0].reject(new Error("offline"));
            expect(await first).toBe(false);
            expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["f1"]);
            answers[2].resolve();
            expect(await third).toBe(true);
            answers[1].reject(new Error("offline"));
            expect(await second).toBe(false);
            expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["f1", "f2"]);
            expect(get(list.files)).toMatchObject({ count: 4, bytes: 700 });
            expect(get(list.files).sent.total).toBe(2);
        });

        describe("more than the first look", () => {
            const sentFile = (n: number) => file({ id: `s${n}`, name: `sent-${n}.pdf`, sizeBytes: 10 });
            const firstLook = () =>
                answer({
                    made: {
                        files: [file({ id: "m1", name: "made-1.pdf" })],
                        total: 5,
                        artifacts: 1,
                        fileTotal: 4,
                        nextCursor: "made-next",
                    },
                    sent: { files: [sentFile(1), sentFile(2)], total: 5, nextCursor: "sent-next" },
                    count: 9,
                    bytes: 90,
                });
            const page = (section: "made" | "sent", files: unknown[], total: number, nextCursor: string | null) => ({
                section,
                files,
                total,
                nextCursor,
            });

            it("goes on from where the list stopped, each file once, until there are no more", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage
                    .mockResolvedValueOnce(page("sent", [sentFile(2), sentFile(3), sentFile(4)], 5, "sent-last"))
                    .mockResolvedValueOnce(page("sent", [sentFile(5)], 5, null));
                const list = brickFilesList(BRICK);
                await list.load();
                expect(await list.more("sent")).toBe(true);
                expect(orbit.getBrickFilesPage).toHaveBeenLastCalledWith(BRICK, {
                    section: "sent",
                    cursor: "sent-next",
                    search: undefined,
                });
                // sent-2 came again in the page: it is not listed twice
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s1", "s2", "s3", "s4"]);
                expect(get(list.files).sent.nextCursor).toBe("sent-last");
                expect(await list.more("sent")).toBe(true);
                expect(orbit.getBrickFilesPage).toHaveBeenLastCalledWith(BRICK, {
                    section: "sent",
                    cursor: "sent-last",
                    search: undefined,
                });
                expect(get(list.files).sent.files).toHaveLength(5);
                expect(get(list.files).sent.nextCursor).toBeNull();
                // Nothing more to ask for: it asks nothing
                orbit.getBrickFilesPage.mockClear();
                expect(await list.more("sent")).toBe(true);
                expect(orbit.getBrickFilesPage).not.toHaveBeenCalled();
                // What it made is its own list, still at the start
                expect(get(list.files).made.files.map((one) => one.id)).toEqual(["m1"]);
                expect(get(list.files).made.nextCursor).toBe("made-next");
            });

            it("says so, and keeps what it has and its place, when a page cannot be read", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage
                    .mockRejectedValueOnce(new Error("offline"))
                    .mockResolvedValueOnce({ files: [], total: 0 })
                    .mockResolvedValueOnce(page("sent", [sentFile(3)], 5, "sent-last"));
                const list = brickFilesList(BRICK);
                await list.load();
                expect(await list.more("sent")).toBe(false);
                // An answer that is not a page is not an empty last page
                expect(await list.more("sent")).toBe(false);
                expect(get(list.files).sent.files).toHaveLength(2);
                expect(get(list.files).sent.nextCursor).toBe("sent-next");
                expect(await list.more("sent")).toBe(true);
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s1", "s2", "s3"]);
            });

            it("asks one page at a time for a list, and shows which list is loading", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                let answerPage: (value: unknown) => void = () => undefined;
                orbit.getBrickFilesPage.mockImplementation(
                    () =>
                        new Promise((resolve) => {
                            answerPage = resolve;
                        })
                );
                const list = brickFilesList(BRICK);
                await list.load();
                const first = list.more("sent");
                const second = list.more("sent");
                expect(orbit.getBrickFilesPage).toHaveBeenCalledTimes(1);
                expect([...get(list.loadingMore)]).toEqual(["sent"]);
                answerPage(page("sent", [sentFile(3)], 5, null));
                await Promise.all([first, second]);
                expect([...get(list.loadingMore)]).toEqual([]);
                expect(get(list.files).sent.files).toHaveLength(3);
            });

            it("searches the names of every file in both lists, not only the ones loaded, and goes back to the newest", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve(
                        asked.section === "made" ? page("made", [], 0, null) : page("sent", [sentFile(120)], 1, null)
                    )
                );
                const list = brickFilesList(BRICK);
                await list.load();
                expect(await list.find("  passport ")).toBe(true);
                expect(orbit.getBrickFilesPage).toHaveBeenCalledWith(BRICK, { section: "made", search: "passport" });
                expect(orbit.getBrickFilesPage).toHaveBeenCalledWith(BRICK, { section: "sent", search: "passport" });
                expect(get(list.query)).toBe("passport");
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s120"]);
                expect(get(list.files).sent.total).toBe(1);
                expect(get(list.files).made).toMatchObject({ files: [], fileTotal: 0, artifacts: 1 });
                // What is overall stays overall
                expect(get(list.files)).toMatchObject({ count: 9, bytes: 90 });
                expect(get(list.search)).toBe("idle");

                // Blank: the newest again, as loaded, with no new question to Orbit
                orbit.getBrickFilesPage.mockClear();
                expect(await list.find("   ")).toBe(true);
                expect(orbit.getBrickFilesPage).not.toHaveBeenCalled();
                expect(get(list.query)).toBe("");
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s1", "s2"]);
            });

            it("goes on through the files found under the same words", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage
                    .mockResolvedValueOnce(page("made", [], 0, null))
                    .mockResolvedValueOnce(page("sent", [sentFile(7)], 3, "found-next"))
                    .mockResolvedValueOnce(page("sent", [sentFile(8), sentFile(9)], 3, null));
                const list = brickFilesList(BRICK);
                await list.load();
                await list.find("tax");
                await list.more("sent");
                expect(orbit.getBrickFilesPage).toHaveBeenLastCalledWith(BRICK, {
                    section: "sent",
                    cursor: "found-next",
                    search: "tax",
                });
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s7", "s8", "s9"]);
            });

            it("shows no files of another search under these words, and says when the search failed", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage
                    .mockResolvedValueOnce(page("made", [], 0, null))
                    .mockResolvedValueOnce(page("sent", [sentFile(7)], 1, null))
                    .mockRejectedValue(new Error("offline"));
                const list = brickFilesList(BRICK);
                await list.load();
                await list.find("tax");
                expect(await list.find("visa")).toBe(false);
                expect(get(list.search)).toBe("failed");
                expect(get(list.query)).toBe("visa");
                // The files of "tax" are not the files of "visa": the list is back to the newest, and the page says it failed
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s1", "s2"]);
            });

            it("drops an answer that belongs to an earlier search or an earlier read", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                const waiting: { words: string; answer: (value: unknown) => void }[] = [];
                orbit.getBrickFilesPage.mockImplementation(
                    (_id, asked) =>
                        new Promise((resolve) => {
                            waiting.push({ words: `${asked.section}:${asked.search ?? ""}`, answer: resolve });
                        })
                );
                const list = brickFilesList(BRICK);
                await list.load();
                const early = list.find("old");
                const late = list.find("new");
                // The later search is answered first, then the earlier one
                for (const wait of waiting.filter((one) => one.words.endsWith("new")))
                    wait.answer(
                        page(
                            wait.words.startsWith("made") ? "made" : "sent",
                            wait.words.startsWith("made") ? [] : [sentFile(1)],
                            wait.words.startsWith("made") ? 0 : 1,
                            null
                        )
                    );
                await late;
                for (const wait of waiting.filter((one) => one.words.endsWith("old")))
                    wait.answer(
                        page(
                            wait.words.startsWith("made") ? "made" : "sent",
                            wait.words.startsWith("made") ? [] : [sentFile(99)],
                            wait.words.startsWith("made") ? 0 : 1,
                            null
                        )
                    );
                await early;
                expect(get(list.query)).toBe("new");
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s1"]);
            });

            it("reads every file of both lists for an export, a page at a time, from the start", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage.mockImplementation((_id, asked) => {
                    if (asked.section === "made")
                        return Promise.resolve(
                            asked.cursor
                                ? page("made", [file({ id: "m3" })], 3, null)
                                : page("made", [file({ id: "m1" }), file({ id: "m2" })], 3, "m-next")
                        );
                    if (asked.cursor === "s-2") return Promise.resolve(page("sent", [sentFile(51)], 51, null));
                    return Promise.resolve(page("sent", [sentFile(1), sentFile(2)], 51, "s-2"));
                });
                const list = brickFilesList(BRICK);
                await list.load();
                const seen: string[] = [];
                for await (const files of list.everyFile()) seen.push(...files.map((one) => one.id));
                expect(seen).toEqual(["m1", "m2", "m3", "s1", "s2", "s51"]);
                // From the start, not from the first look's place: the export is the whole list
                expect(
                    orbit.getBrickFilesPage.mock.calls.map(([, asked]) => `${asked.section}:${asked.cursor ?? "-"}`)
                ).toEqual(["made:-", "made:m-next", "sent:-", "sent:s-2"]);
            });

            it("exports only what a search found, while one is shown", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage.mockResolvedValue(page("made", [], 0, null));
                orbit.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve(page(asked.section, [], 0, null))
                );
                const list = brickFilesList(BRICK);
                await list.load();
                await list.find("tax");
                orbit.getBrickFilesPage.mockClear();
                for await (const files of list.everyFile()) expect(files).toEqual([]);
                expect(orbit.getBrickFilesPage.mock.calls.map(([, asked]) => asked.search)).toEqual(["tax", "tax"]);
            });

            it("stops an export with an error when a page cannot be read or the list stops going on", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                const list = brickFilesList(BRICK);
                await list.load();
                orbit.getBrickFilesPage
                    .mockResolvedValueOnce(page("made", [file({ id: "m1" })], 2, "m-next"))
                    .mockRejectedValueOnce(new Error("offline"));
                const seen: string[] = [];
                await expect(
                    (async () => {
                        for await (const files of list.everyFile()) seen.push(...files.map((one) => one.id));
                    })()
                ).rejects.toThrow("offline");
                expect(seen).toEqual(["m1"]);
                // A list that sends the same place again and again would never end
                orbit.getBrickFilesPage.mockReset();
                orbit.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve(page(asked.section, [file({ id: "m1" })], 9, "same"))
                );
                await expect(
                    (async () => {
                        for await (const files of list.everyFile()) expect(files).toHaveLength(1);
                    })()
                ).rejects.toThrow();
            });

            it("keeps its place and its counts when files are deleted while it goes on, even one that was not loaded", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.deleteBrickFile.mockResolvedValue({ deleted: true });
                orbit.getBrickFilesPage
                    .mockResolvedValueOnce(page("made", [], 0, null))
                    .mockResolvedValueOnce(page("sent", [sentFile(300)], 1, null))
                    .mockResolvedValueOnce(page("sent", [sentFile(3), sentFile(4)], 4, null));
                const list = brickFilesList(BRICK);
                await list.load();
                // A file only the search loaded goes: the first look counts it out too
                await list.find("old");
                expect(await list.deleteSent("s300")).toBe(true);
                expect(get(list.files).sent.files).toEqual([]);
                await list.find("");
                expect(get(list.files)).toMatchObject({ count: 8, bytes: 80 });
                expect(get(list.files).sent.total).toBe(4);
                // Delete a loaded file, then go on: the next page starts where it did, and nothing is shown twice
                expect(await list.deleteSent("s1")).toBe(true);
                expect(await list.more("sent")).toBe(true);
                expect(orbit.getBrickFilesPage).toHaveBeenLastCalledWith(BRICK, {
                    section: "sent",
                    cursor: "sent-next",
                    search: undefined,
                });
                expect(get(list.files).sent.files.map((one) => one.id)).toEqual(["s2", "s3", "s4"]);
            });

            it("reads the first look again from the start, with no search and no old pages", async () => {
                orbit.getBrickFiles.mockResolvedValue(firstLook());
                orbit.getBrickFilesPage.mockImplementation((_id, asked) =>
                    Promise.resolve(page(asked.section, [], 0, null))
                );
                const list = brickFilesList(BRICK);
                await list.load();
                await list.find("tax");
                await list.load();
                expect(get(list.query)).toBe("");
                expect(get(list.search)).toBe("idle");
                expect(get(list.files).sent.files).toHaveLength(2);
            });
        });
    });
});
