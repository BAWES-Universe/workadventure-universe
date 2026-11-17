import { writable, type Readable } from "svelte/store";
import { UPLOADER_URL } from "../../Enum/EnvironmentVariable";
import { botApiService } from "../../external-modules/bots/services/BotApiService";

/**
 * A Brick's files in one place for its owner (game #2003): what it made for them, what they sent it, and what is on
 * its computer once it has one. The page can look and download. The one change it allows is deleting a file the person
 * sent. A download follows the file's real audience: the link is the file's own lasting link, handed to the owner of the
 * Brick and nobody else, and looking never makes a file more open than it was.
 */

export type FileAudience = "you" | "chat";
export type FileStore = { bucket: string; fileId: string } | { url: string };

export interface BrickFile {
    id: string;
    name: string;
    kind: string;
    sizeBytes: number | null;
    /** When it came, in milliseconds. */
    at: number;
    /** Only the Brick and the person ("you"), or in a nearby chat with other people there ("chat"). */
    audience: FileAudience;
    store: FileStore;
}

/** What is on the Brick's computer, from Orbit's last reading (never from waking it). Null until a Brick has one. */
export interface BrickComputerFiles {
    state: "on" | "resting" | "off";
    files: number;
    bytes: number;
    /** When the last copy was saved, in milliseconds. */
    savedAt: number | null;
}

export type FileSection = "made" | "sent";

export interface BrickFiles {
    /**
     * `files` are the ones loaded so far, newest first. `total` counts every file it made and every artifact it made,
     * `fileTotal` only the files (the ones found, while a search is shown). `nextCursor` asks for the older ones: null
     * when `files` has them all.
     */
    made: { files: BrickFile[]; total: number; artifacts: number; fileTotal: number; nextCursor: string | null };
    sent: { files: BrickFile[]; total: number; nextCursor: string | null };
    computer: BrickComputerFiles | null;
    /** Every file made and sent, and their size, whatever is loaded or searched for. */
    count: number;
    bytes: number;
}

/** One page of one list, as Orbit answers it. */
export interface BrickFilesPage {
    files: BrickFile[];
    total: number;
    nextCursor: string | null;
}

const EMPTY: BrickFiles = {
    made: { files: [], total: 0, artifacts: 0, fileTotal: 0, nextCursor: null },
    sent: { files: [], total: 0, nextCursor: null },
    computer: null,
    count: 0,
    bytes: 0,
};

const num = (value: unknown, fallback = 0): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
const time = (value: unknown): number | null => {
    const at = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isNaN(at) ? null : at;
};

function parseFile(value: unknown): BrickFile | null {
    const one = (value ?? {}) as Record<string, unknown>;
    const store = (one.store ?? {}) as Record<string, unknown>;
    const placed: FileStore | null =
        typeof store.bucket === "string" && typeof store.fileId === "string" && store.bucket && store.fileId
            ? { bucket: store.bucket, fileId: store.fileId }
            : typeof store.url === "string" && store.url
            ? { url: store.url }
            : null;
    const at = time(one.at);
    if (typeof one.id !== "string" || !one.id || typeof one.name !== "string" || !one.name || !placed || at === null)
        return null;
    return {
        id: one.id,
        name: one.name,
        kind: typeof one.kind === "string" ? one.kind : "file",
        sizeBytes: typeof one.sizeBytes === "number" && one.sizeBytes >= 0 ? one.sizeBytes : null,
        at,
        audience: one.audience === "chat" ? "chat" : "you",
        store: placed,
    };
}

const parseFiles = (value: unknown): BrickFile[] =>
    Array.isArray(value) ? value.flatMap((one) => parseFile(one) ?? []) : [];

/** Where the next page starts: Orbit's own text, or none when there is no next page. */
const cursorOf = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= 400 ? value : null;

/**
 * Orbit's answer for one page of one list. Throws when it is not a page (an Orbit that does not page answers with the
 * first look again): a page that was not read is never taken for an empty or a last one.
 */
export function parseBrickFilesPage(value: unknown, section: FileSection): BrickFilesPage {
    const answer = (value ?? {}) as { section?: unknown; files?: unknown; total?: unknown; nextCursor?: unknown };
    if (typeof answer !== "object" || answer.section !== section || !Array.isArray(answer.files))
        throw new Error("Not a page of files");
    const files = parseFiles(answer.files);
    return { files, total: Math.max(num(answer.total), files.length), nextCursor: cursorOf(answer.nextCursor) };
}

/** Orbit's answer for a Brick's files. Anything that is not whole is left out. */
export function parseBrickFiles(value: unknown): BrickFiles {
    const answer = (value ?? {}) as {
        made?: { files?: unknown; total?: unknown; artifacts?: unknown; fileTotal?: unknown; nextCursor?: unknown };
        sent?: { files?: unknown; total?: unknown; nextCursor?: unknown };
        computer?: Record<string, unknown> | null;
        count?: unknown;
        bytes?: unknown;
    };
    if (typeof answer !== "object" || !answer.made || !answer.sent) return EMPTY;
    const made = parseFiles(answer.made.files);
    const sent = parseFiles(answer.sent.files);
    const { computer } = answer;
    return {
        made: {
            files: made,
            total: Math.max(num(answer.made.total), made.length),
            artifacts: num(answer.made.artifacts),
            fileTotal: Math.max(num(answer.made.fileTotal, made.length), made.length),
            nextCursor: cursorOf(answer.made.nextCursor),
        },
        sent: {
            files: sent,
            total: Math.max(num(answer.sent.total), sent.length),
            nextCursor: cursorOf(answer.sent.nextCursor),
        },
        computer:
            computer && (computer.state === "on" || computer.state === "resting" || computer.state === "off")
                ? {
                      state: computer.state,
                      files: num(computer.files),
                      bytes: num(computer.bytes),
                      savedAt: time(computer.savedAt),
                  }
                : null,
        count: num(answer.count),
        bytes: num(answer.bytes),
    };
}

/** "212 KB", "1.4 MB": plain sizes, one decimal only where it helps. */
export function fileSize(bytes: number, locale?: string): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 0 : 1;
    const text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(
        digits === 0 ? Math.round(value) : Math.round(value * 10) / 10
    );
    return `${text} ${units[unit]}`;
}

/** Where a file opens: the uploader's own lasting link, which hands out a fresh one each time; a link is a link. */
export function fileLink(store: FileStore, uploaderUrl: string | undefined = UPLOADER_URL): string | undefined {
    if ("url" in store) return /^https?:\/\//i.test(store.url) ? store.url : undefined;
    if (!uploaderUrl) return undefined;
    const part = (text: string) => text.split("/").map(encodeURIComponent).join("/");
    return `${uploaderUrl.replace(/\/+$/, "")}/chat-file/${part(store.bucket)}/${part(store.fileId)}`;
}

/** The icon family of a file, by its name. */
export function fileIconKind(file: Pick<BrickFile, "name" | "kind">): "sheet" | "image" | "file" {
    if (/\.(xlsx?|csv|ods|numbers)$/i.test(file.name)) return "sheet";
    if (file.kind === "media" || /\.(png|jpe?g|gif|webp|heic|svg|mp4|mov|webm|mp3|wav|m4a)$/i.test(file.name))
        return "image";
    return "file";
}

/** Starts a download of one file in the browser. Changes nothing. Returns false when the file has no link. */
export function downloadFile(
    file: Pick<BrickFile, "name" | "store">,
    document: Document = globalThis.document
): boolean {
    const href = fileLink(file.store);
    if (!href) return false;
    const link = document.createElement("a");
    link.href = href;
    link.download = file.name;
    link.rel = "noopener";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
}

/**
 * Gives each file in a zip a name of its own, one at a time: the same name twice becomes "name (2).ext". Every name given
 * out is kept, so "a.pdf" twice beside a file really called "a (2).pdf" never gives one name to two files.
 */
export function zipNamer(): (name: string) => string {
    const taken = new Set<string>();
    return (name) => {
        const clean = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "file";
        let candidate = clean;
        const dot = clean.lastIndexOf(".");
        for (let times = 2; taken.has(candidate.toLowerCase()); times++) {
            candidate = dot > 0 ? `${clean.slice(0, dot)} (${times})${clean.slice(dot)}` : `${clean} (${times})`;
        }
        taken.add(candidate.toLowerCase());
        return candidate;
    };
}

/** One name for each file in the zip: the same name twice becomes "name (2).ext". */
export function zipNames(names: string[]): string[] {
    const give = zipNamer();
    return names.map(give);
}

/** What an export put in the zip. */
export interface EverythingResult {
    /** Files in the zip. */
    added: number;
    /** Files that could not be read, so they are not in it. */
    missed: number;
    /** False when the list itself stopped coming part of the way (a page could not be read): files after that are not in it. */
    complete: boolean;
}

/**
 * One zip with files, put together in the browser from the files' own links. `files` is a list, or the pages of a list
 * as they come (a page that cannot be read ends the walk, and the zip says it is not whole). Files that cannot be read
 * are left out of it, and said: the caller gets how many went in, how many did not, and whether the whole list was
 * read. Nothing is changed.
 */
export async function downloadEverything(
    files: Pick<BrickFile, "name" | "store">[] | AsyncIterable<Pick<BrickFile, "name" | "store">[]>,
    zipName: string,
    fetcher: typeof fetch = (...args) => fetch(...args)
): Promise<EverythingResult | undefined> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const nameOf = zipNamer();
    let added = 0;
    let missed = 0;
    let complete = true;
    const pages: Iterable<Pick<BrickFile, "name" | "store">[]> | AsyncIterable<Pick<BrickFile, "name" | "store">[]> =
        Array.isArray(files) ? [files] : files;
    try {
        for await (const page of pages) {
            for (const file of page) {
                const name = nameOf(file.name);
                const href = fileLink(file.store);
                try {
                    if (!href) throw new Error("no link");
                    // eslint-disable-next-line no-await-in-loop
                    const response = await fetcher(href);
                    if (!response.ok) throw new Error(`status ${response.status}`);
                    // eslint-disable-next-line no-await-in-loop
                    zip.file(name, await response.blob());
                    added++;
                } catch {
                    missed++;
                }
            }
        }
    } catch (error) {
        console.warn("Could not read the whole list of files", error);
        complete = false;
    }
    if (added === 0) return undefined;
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = zipName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { added, missed, complete };
}

export type FilesState = "loading" | "ready" | "failed";
export type SearchState = "idle" | "searching" | "failed";

export interface BrickFilesList {
    /** What the page shows: the files loaded so far, or the files found while a search is shown. */
    files: Readable<BrickFiles>;
    state: Readable<FilesState>;
    /** The words being searched for ("" when none), once Orbit has answered for them. */
    query: Readable<string>;
    search: Readable<SearchState>;
    /** The lists that are loading their next page right now. */
    loadingMore: Readable<ReadonlySet<FileSection>>;
    load(): Promise<void>;
    /** Looks for these words in the names of every file, made and sent (none: back to the newest). True when it was read. */
    find(words: string): Promise<boolean>;
    /** Loads the next page of a list, below the files already shown. True when it was read (or there is no more). */
    more(section: FileSection): Promise<boolean>;
    /**
     * Every file of both lists, a page at a time as the person's own export reads them: the files found while a search
     * is shown, all of them otherwise. A page that cannot be read ends it with an error.
     */
    everyFile(): AsyncGenerator<BrickFile[]>;
    /** Deletes a file the person sent. It goes at once and comes back if Orbit refuses. True when it is gone. */
    deleteSent(fileId: string): Promise<boolean>;
}

/** Files of a list after the ones already there, each once. */
const appended = (have: BrickFile[], page: BrickFile[]): BrickFile[] => {
    const seen = new Set(have.map((file) => file.id));
    return [...have, ...page.filter((file) => !seen.has(file.id))];
};

/** One Brick's files for its owner. A read that fails says so; it never shows files it did not read. */
export function brickFilesList(brickId: string): BrickFilesList {
    const files = writable<BrickFiles>(EMPTY);
    const state = writable<FilesState>("loading");
    const query = writable("");
    const search = writable<SearchState>("idle");
    const loadingMore = writable<ReadonlySet<FileSection>>(new Set());
    // What Orbit last said (the first look and the pages after it), what it said for the words being searched for, and
    // the files the person has asked to delete that Orbit has not answered yet. What is shown is the search or else the
    // first look, without the third, so a Delete that fails brings back only its own file, whatever else is in flight.
    let known = EMPTY;
    let found: BrickFiles | undefined;
    let words = "";
    // Counts each search and each load: an answer that belongs to an older one says nothing about the current one
    let turn = 0;
    const going = new Set<FileSection>();
    const pending = new Set<string>();
    const without = (from: BrickFiles, ids: ReadonlySet<string>): BrickFiles => {
        const gone = from.sent.files.filter((file) => ids.has(file.id));
        if (gone.length === 0) return from;
        return {
            ...from,
            sent: {
                ...from.sent,
                files: from.sent.files.filter((file) => !ids.has(file.id)),
                total: Math.max(0, from.sent.total - gone.length),
            },
            count: Math.max(0, from.count - gone.length),
            bytes: Math.max(0, from.bytes - gone.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)),
        };
    };
    // A file Orbit has deleted, taken out of a list and out of every count, whether or not it was loaded there
    const deleted = (from: BrickFiles, id: string, size: number): BrickFiles => ({
        ...from,
        sent: {
            ...from.sent,
            files: from.sent.files.filter((file) => file.id !== id),
            total: Math.max(0, from.sent.total - 1),
        },
        count: Math.max(0, from.count - 1),
        bytes: Math.max(0, from.bytes - size),
    });
    const show = () => files.set(without(found ?? known, pending));
    const flag = () => loadingMore.set(new Set(going));

    return {
        files: { subscribe: files.subscribe },
        state: { subscribe: state.subscribe },
        query: { subscribe: query.subscribe },
        search: { subscribe: search.subscribe },
        loadingMore: { subscribe: loadingMore.subscribe },
        async load() {
            const mine = ++turn;
            state.set("loading");
            try {
                const read = parseBrickFiles(await botApiService.getBrickFiles(brickId));
                if (mine !== turn) return;
                known = read;
                found = undefined;
                words = "";
                query.set("");
                search.set("idle");
                show();
                state.set("ready");
            } catch (error) {
                console.warn("Could not read a Brick's files", error);
                if (mine === turn) state.set("failed");
            }
        },
        async find(text) {
            const asked = text.trim();
            const mine = ++turn;
            if (asked === "") {
                // Back to the newest, as loaded before
                found = undefined;
                words = "";
                query.set("");
                search.set("idle");
                show();
                return true;
            }
            search.set("searching");
            try {
                const [made, sent] = await Promise.all([
                    botApiService.getBrickFilesPage(brickId, { section: "made", search: asked }),
                    botApiService.getBrickFilesPage(brickId, { section: "sent", search: asked }),
                ]);
                if (mine !== turn) return true;
                const madePage = parseBrickFilesPage(made, "made");
                const sentPage = parseBrickFilesPage(sent, "sent");
                found = {
                    ...known,
                    made: {
                        files: madePage.files,
                        total: known.made.total,
                        artifacts: known.made.artifacts,
                        fileTotal: madePage.total,
                        nextCursor: madePage.nextCursor,
                    },
                    sent: { files: sentPage.files, total: sentPage.total, nextCursor: sentPage.nextCursor },
                };
                words = asked;
                query.set(asked);
                search.set("idle");
                show();
                return true;
            } catch (error) {
                console.warn("Could not search a Brick's files", error);
                if (mine === turn) {
                    // Files of another search are never shown under these words
                    found = undefined;
                    words = asked;
                    query.set(asked);
                    search.set("failed");
                    show();
                }
                return false;
            }
        },
        async more(section) {
            const shown = found ?? known;
            const cursor = shown[section].nextCursor;
            if (!cursor) return true;
            if (going.has(section)) return true;
            const mine = turn;
            going.add(section);
            flag();
            try {
                const page = parseBrickFilesPage(
                    await botApiService.getBrickFilesPage(brickId, { section, cursor, search: words || undefined }),
                    section
                );
                // The person searched, or the files were read again, while this page was on its way
                if (mine !== turn) return true;
                const add = <T extends { files: BrickFile[]; nextCursor: string | null }>(list: T): T => ({
                    ...list,
                    files: appended(list.files, page.files),
                    nextCursor: page.nextCursor,
                });
                const place = found ?? known;
                const next: BrickFiles =
                    section === "made"
                        ? {
                              ...place,
                              made: { ...add(place.made), fileTotal: Math.max(place.made.fileTotal, page.total) },
                          }
                        : { ...place, sent: { ...add(place.sent), total: Math.max(place.sent.total, page.total) } };
                // Read again after the answer came, and only if no other search or read has begun since (`turn`)
                if (found) found = next;
                // eslint-disable-next-line require-atomic-updates
                else known = next;
                show();
                return true;
            } catch (error) {
                console.warn("Could not read more files", error);
                return false;
            } finally {
                going.delete(section);
                flag();
            }
        },
        async *everyFile() {
            for (const section of ["made", "sent"] as const) {
                let cursor: string | null = null;
                do {
                    const page: BrickFilesPage = parseBrickFilesPage(
                        // eslint-disable-next-line no-await-in-loop
                        await botApiService.getBrickFilesPage(brickId, {
                            section,
                            cursor,
                            search: words || undefined,
                        }),
                        section
                    );
                    yield page.files;
                    // A list that sends the same place twice would never end
                    if (page.nextCursor !== null && page.nextCursor === cursor)
                        throw new Error("The list did not go on");
                    cursor = page.nextCursor;
                } while (cursor);
            }
        },
        async deleteSent(fileId) {
            pending.add(fileId);
            show();
            try {
                await botApiService.deleteBrickFile(brickId, fileId);
                const gone = [...(found?.sent.files ?? []), ...known.sent.files].find((file) => file.id === fileId);
                const size = gone?.sizeBytes ?? 0;
                // The search shows only the files it found: the first look still counts the file if the search never loaded it
                if (found) {
                    const had = found.sent.files.some((file) => file.id === fileId);
                    found = had ? deleted(found, fileId, size) : { ...found };
                }
                known = deleted(known, fileId, size);
                return true;
            } catch (error) {
                console.warn("Could not delete a file", error);
                return false;
            } finally {
                pending.delete(fileId);
                show();
            }
        },
    };
}
