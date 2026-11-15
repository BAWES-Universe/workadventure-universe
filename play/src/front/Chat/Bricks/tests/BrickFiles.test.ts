import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const orbit = vi.hoisted(() => ({
    getBrickFiles: vi.fn<(brickId: string) => Promise<unknown>>(),
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
    made: { files: [file()], total: 6, artifacts: 4 },
    sent: { files: [file({ id: "f2", name: "passport.pdf", audience: "chat" })], total: 1 },
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
            expect(result).toEqual({ added: 1, missed: 1 });
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
    });
});
