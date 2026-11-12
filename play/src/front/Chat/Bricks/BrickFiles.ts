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

export interface BrickFiles {
    made: { files: BrickFile[]; total: number; artifacts: number };
    sent: { files: BrickFile[]; total: number };
    computer: BrickComputerFiles | null;
    count: number;
    bytes: number;
}

const EMPTY: BrickFiles = {
    made: { files: [], total: 0, artifacts: 0 },
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

/** Orbit's answer for a Brick's files. Anything that is not whole is left out. */
export function parseBrickFiles(value: unknown): BrickFiles {
    const answer = (value ?? {}) as {
        made?: { files?: unknown; total?: unknown; artifacts?: unknown };
        sent?: { files?: unknown; total?: unknown };
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

/** One name for each file in the zip: the same name twice becomes "name (2).ext". */
export function zipNames(names: string[]): string[] {
    const seen = new Map<string, number>();
    return names.map((name) => {
        const clean = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "file";
        const times = (seen.get(clean.toLowerCase()) ?? 0) + 1;
        seen.set(clean.toLowerCase(), times);
        if (times === 1) return clean;
        const dot = clean.lastIndexOf(".");
        return dot > 0 ? `${clean.slice(0, dot)} (${times})${clean.slice(dot)}` : `${clean} (${times})`;
    });
}

/**
 * One zip with all the files the page lists, put together in the browser from the files' own links. Files that cannot
 * be read are left out of it, and said: the caller gets how many went in and how many did not. Nothing is changed.
 */
export async function downloadEverything(
    files: Pick<BrickFile, "name" | "store">[],
    zipName: string,
    fetcher: typeof fetch = (...args) => fetch(...args)
): Promise<{ added: number; missed: number } | undefined> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const names = zipNames(files.map((file) => file.name));
    let added = 0;
    let missed = 0;
    for (const [index, file] of files.entries()) {
        const href = fileLink(file.store);
        try {
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
        if (going.length === 0) return from;
        return {
            ...from,
            sent: {
                files: from.sent.files.filter((file) => !ids.has(file.id)),
                total: Math.max(0, from.sent.total - going.length),
            },
            count: Math.max(0, from.count - going.length),
            bytes: Math.max(0, from.bytes - going.reduce((total, file) => total + (file.sizeBytes ?? 0), 0)),
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
