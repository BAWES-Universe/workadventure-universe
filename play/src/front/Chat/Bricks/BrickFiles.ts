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

/** Whether the chat took a file its computer made: "waiting" while it is still being sent, "not_delivered" once the chat did not (and will not) take it. */
export type ResultDelivery = "delivered" | "waiting" | "not_delivered";

/** A file the Brick's computer made for the person: theirs in Files whether or not the chat took it. */
export interface BrickResult {
    id: string;
    name: string;
    sizeBytes: number;
    /** The job it came from. */
    job: string;
    /** When it was made, in milliseconds. */
    at: number;
    delivery: ResultDelivery;
    /** Which Brick made it, when the list is not one Brick's own Files: "A deleted Brick" for one that is gone. */
    brick?: string;
}

export interface BrickFiles {
    made: { files: BrickFile[]; total: number; artifacts: number };
    /** What its computer made, newest first. */
    results: BrickResult[];
    sent: { files: BrickFile[]; total: number };
    computer: BrickComputerFiles | null;
    count: number;
    bytes: number;
}

const EMPTY: BrickFiles = {
    made: { files: [], total: 0, artifacts: 0 },
    results: [],
    sent: { files: [], total: 0 },
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

function parseResult(value: unknown): BrickResult | null {
    const one = (value ?? {}) as Record<string, unknown>;
    const at = time(one.at);
    if (typeof one.id !== "string" || !one.id || typeof one.name !== "string" || !one.name || at === null) return null;
    return {
        id: one.id,
        name: one.name,
        sizeBytes: num(one.sizeBytes),
        job: typeof one.job === "string" ? one.job : "",
        ...(typeof one.brick === "string" && one.brick ? { brick: one.brick } : {}),
        at,
        // A state it does not know is shown as not in the chat: never as delivered
        delivery: one.delivery === "delivered" ? "delivered" : one.delivery === "waiting" ? "waiting" : "not_delivered",
    };
}

const parseResults = (value: unknown): BrickResult[] =>
    Array.isArray(value) ? value.flatMap((one) => parseResult(one) ?? []) : [];

/** Orbit's answer for the results whose Brick is gone: the person's own files, with "A deleted Brick" on them. Anything not whole is left out. */
export function parseDeletedBrickResults(value: unknown): BrickResult[] {
    return parseResults((value as { results?: unknown } | null)?.results);
}

/** Where the next page of the results of deleted Bricks starts, when Orbit says there is one. */
export function nextDeletedBrickResultsPage(value: unknown): string | null {
    const next = (value as { next?: unknown } | null)?.next;
    return typeof next === "string" && next !== "" ? next : null;
}

/** The most pages of results of deleted Bricks read in one go (a hundred a time): far more than a person has, and a stop for an answer that never ends. */
const DELETED_RESULTS_PAGES_MAX = 50;

/** Orbit's answer for a Brick's files. Anything that is not whole is left out. */
export function parseBrickFiles(value: unknown): BrickFiles {
    const answer = (value ?? {}) as {
        made?: { files?: unknown; total?: unknown; artifacts?: unknown };
        sent?: { files?: unknown; total?: unknown };
        results?: unknown;
        computer?: Record<string, unknown> | null;
        count?: unknown;
        bytes?: unknown;
    };
    if (typeof answer !== "object" || !answer.made || !answer.sent) return EMPTY;
    const made = parseFiles(answer.made.files);
    const sent = parseFiles(answer.sent.files);
    const { computer } = answer;
    return {
        results: parseResults(answer.results),
        made: {
            files: made,
            total: Math.max(num(answer.made.total), made.length),
            artifacts: num(answer.made.artifacts),
        },
        sent: { files: sent, total: Math.max(num(answer.sent.total), sent.length) },
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

/** Starts a download of bytes the game already has in the browser. */
function saveBlob(name: string, blob: Blob, document: Document = globalThis.document): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One name for each file in the zip: the same name twice becomes "name (2).ext". */
export function zipNames(names: string[]): string[] {
    // Every name given out is kept, so "a.pdf" twice beside a file really called "a (2).pdf" never gives one name to two files
    const taken = new Set<string>();
    return names.map((name) => {
        const clean = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "file";
        let candidate = clean;
        const dot = clean.lastIndexOf(".");
        for (let times = 2; taken.has(candidate.toLowerCase()); times++) {
            candidate = dot > 0 ? `${clean.slice(0, dot)} (${times})${clean.slice(dot)}` : `${clean} (${times})`;
        }
        taken.add(candidate.toLowerCase());
        return candidate;
    });
}

/**
 * One zip with all the files the page lists, put together in the browser from the files' own links. Files that cannot
 * be read are left out of it, and said: the caller gets how many went in and how many did not. Nothing is changed.
 */
export async function downloadEverything(
    files: ({ name: string; store: FileStore } | { name: string; load: () => Promise<Blob> })[],
    zipName: string,
    fetcher: typeof fetch = (...args) => fetch(...args)
): Promise<{ added: number; missed: number } | undefined> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const names = zipNames(files.map((file) => file.name));
    let added = 0;
    let missed = 0;
    for (const [index, file] of files.entries()) {
        try {
            if ("load" in file) {
                // A result of its computer: opened with the person's own sign-in, not from a link
                // eslint-disable-next-line no-await-in-loop
                zip.file(names[index], await file.load());
                added++;
                continue;
            }
            const href = fileLink(file.store);
            if (!href) throw new Error("no link");
            // eslint-disable-next-line no-await-in-loop
            const response = await fetcher(href);
            if (!response.ok) throw new Error(`status ${response.status}`);
            // eslint-disable-next-line no-await-in-loop
            zip.file(names[index], await response.blob());
            added++;
        } catch {
            missed++;
        }
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
    return { added, missed };
}

export type FilesState = "loading" | "ready" | "failed";

export interface BrickFilesList {
    files: Readable<BrickFiles>;
    state: Readable<FilesState>;
    load(): Promise<void>;
    /** Deletes a file the person sent. It goes at once and comes back if Orbit refuses. True when it is gone. */
    deleteSent(fileId: string): Promise<boolean>;
    /** The bytes of a file its computer made, opened with the person's own sign-in. Throws when it cannot be read. */
    openResult(fileId: string): Promise<Blob>;
    /** Downloads a file its computer made. False when it could not be read. */
    downloadResult(result: Pick<BrickResult, "id" | "name">): Promise<boolean>;
    /** Deletes a file its computer made: it goes at once and comes back if Orbit refuses. True when it is gone. */
    deleteResult(fileId: string): Promise<boolean>;
}

/** One Brick's files for its owner. A read that fails says so; it never shows files it did not read. */
export function brickFilesList(brickId: string): BrickFilesList {
    const files = writable<BrickFiles>(EMPTY);
    const state = writable<FilesState>("loading");
    // What Orbit last said, and the files the person has asked to delete that Orbit has not answered yet. What is shown
    // is the first without the second, so a Delete that fails brings back only its own file, whatever else is in flight.
    let known = EMPTY;
    const pending = new Set<string>();
    const without = (from: BrickFiles, ids: ReadonlySet<string>): BrickFiles => {
        const going = from.sent.files.filter((file) => ids.has(file.id));
        const goingResults = from.results.filter((result) => ids.has(result.id));
        if (going.length === 0 && goingResults.length === 0) return from;
        return {
            ...from,
            sent: {
                files: from.sent.files.filter((file) => !ids.has(file.id)),
                total: Math.max(0, from.sent.total - going.length),
            },
            results: from.results.filter((result) => !ids.has(result.id)),
            count: Math.max(0, from.count - going.length - goingResults.length),
            bytes: Math.max(
                0,
                from.bytes -
                    going.reduce((total, file) => total + (file.sizeBytes ?? 0), 0) -
                    goingResults.reduce((total, result) => total + result.sizeBytes, 0)
            ),
        };
    };
    const show = () => files.set(without(known, pending));

    return {
        files: { subscribe: files.subscribe },
        state: { subscribe: state.subscribe },
        async load() {
            state.set("loading");
            try {
                known = parseBrickFiles(await botApiService.getBrickFiles(brickId));
                show();
                state.set("ready");
            } catch (error) {
                console.warn("Could not read a Brick's files", error);
                state.set("failed");
            }
        },
        async openResult(fileId) {
            return await botApiService.getBrickResult(brickId, fileId);
        },
        async downloadResult(result) {
            try {
                saveBlob(result.name, await botApiService.getBrickResult(brickId, result.id));
                return true;
            } catch (error) {
                console.warn("Could not download a result", error);
                return false;
            }
        },
        async deleteResult(fileId) {
            pending.add(fileId);
            show();
            try {
                await botApiService.deleteBrickResult(brickId, fileId);
                known = without(known, new Set([fileId]));
                return true;
            } catch (error) {
                console.warn("Could not delete a result", error);
                return false;
            } finally {
                pending.delete(fileId);
                show();
            }
        },
        async deleteSent(fileId) {
            pending.add(fileId);
            show();
            try {
                await botApiService.deleteBrickFile(brickId, fileId);
                known = without(known, new Set([fileId]));
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

export interface DeletedBrickFilesList {
    results: Readable<BrickResult[]>;
    /** True when the last read failed (not the same as nothing to show): the page says so and offers to read again. */
    failed: Readable<boolean>;
    load(): Promise<void>;
    /** Forgets everything shown and any read still on its way (the account or Orbit changed in place). */
    reset(): void;
    /** Downloads one, read with the person's own sign-in. False when it could not be read. */
    downloadResult(result: Pick<BrickResult, "id" | "name">): Promise<boolean>;
    /** Deletes one: it goes at once and comes back if Orbit refuses. True when it is gone. */
    deleteResult(fileId: string): Promise<boolean>;
}

/**
 * What a person's Bricks' computers made, that no Brick of theirs is left to show (its Brick was deleted). The files are theirs and stay for the days in Limits or
 * until they delete them. A read that fails shows nothing it did not read.
 */
export function deletedBrickFilesList(): DeletedBrickFilesList {
    const results = writable<BrickResult[]>([]);
    const failed = writable(false);
    let known: BrickResult[] = [];
    const pending = new Set<string>();
    // Only the latest read shows: a slow answer to an earlier one (or to one made for the account before) never covers what is there now
    let reads = 0;
    const show = () => results.set(known.filter((result) => !pending.has(result.id)));
    return {
        results: { subscribe: results.subscribe },
        failed: { subscribe: failed.subscribe },
        reset() {
            reads++;
            known = [];
            pending.clear();
            failed.set(false);
            show();
        },
        async load() {
            const mine = ++reads;
            try {
                // Every page, so a person with many results from deleted Bricks sees them all (a hundred at a time from Orbit)
                const all: BrickResult[] = [];
                const seen = new Set<string>();
                let cursor: string | null = null;
                for (let page = 0; page < DELETED_RESULTS_PAGES_MAX; page++) {
                    // One page after another on purpose: each page says where the next one starts
                    // eslint-disable-next-line no-await-in-loop
                    const answer: unknown = await botApiService.getDeletedBrickResults(cursor);
                    for (const result of parseDeletedBrickResults(answer)) {
                        if (!seen.has(result.id)) {
                            seen.add(result.id);
                            all.push(result);
                        }
                    }
                    cursor = nextDeletedBrickResultsPage(answer);
                    if (!cursor) break;
                }
                if (mine !== reads) return;
                known = all;
                failed.set(false);
                show();
            } catch (error) {
                console.warn("Could not read the files of deleted Bricks", error);
                if (mine === reads) failed.set(true);
            }
        },
        async downloadResult(result) {
            try {
                saveBlob(result.name, await botApiService.getOwnBrickResult(result.id));
                return true;
            } catch (error) {
                console.warn("Could not download a result", error);
                return false;
            }
        },
        async deleteResult(fileId) {
            pending.add(fileId);
            show();
            try {
                await botApiService.deleteOwnBrickResult(fileId);
                known = known.filter((result) => result.id !== fileId);
                return true;
            } catch (error) {
                console.warn("Could not delete a result", error);
                return false;
            } finally {
                pending.delete(fileId);
                show();
            }
        },
    };
}
