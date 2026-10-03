import type { SaveableFile } from "./messageActions";
import { isImageUrl } from "./messageActions";

export type SaveResult = "shared" | "downloaded" | "cancelled" | "failed";

const prepared = new Map<string, Promise<File | undefined>>();

function fetchAsFile(file: SaveableFile): Promise<File | undefined> {
    const key = `${file.url}\n${file.name}`;
    let pending = prepared.get(key);
    if (!pending) {
        pending = fetch(file.url, { mode: "cors", credentials: "omit" })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                return new File([blob], file.name, { type: blob.type || "application/octet-stream" });
            })
            .catch((error) => {
                console.warn("Could not fetch a chat file to save it", file.url, error);
                prepared.delete(key);
                return undefined;
            });
        prepared.set(key, pending);
        // Keep at most a few files in memory: the menu prepares them when it opens.
        if (prepared.size > 12) {
            const oldest = prepared.keys().next().value;
            if (oldest !== undefined) prepared.delete(oldest);
        }
    }
    return pending;
}

/**
 * Starts fetching the files as soon as a menu that offers "Save" opens, so that tapping it can hand them to the share
 * sheet straight away: iOS only opens the share sheet while the tap is recent.
 */
export function prepareFiles(files: SaveableFile[]): void {
    if (!isTouchDevice()) return;
    // Photos only: a video or a large file is fetched when "Save" is tapped, not every time the menu opens.
    for (const file of files.filter((file) => isImageUrl(file.url))) void fetchAsFile(file);
}

function isTouchDevice(): boolean {
    return window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false;
}

function downloadFile(file: File): void {
    const objectUrl = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = file.name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/**
 * Saves a message's files under their real names without leaving the game.
 * On phones it opens the share sheet (Save to Photos, Files...); elsewhere it downloads them.
 * A file whose server refuses to be read from the game (no CORS) cannot be saved this way: the caller says so.
 */
export async function saveFiles(files: SaveableFile[]): Promise<SaveResult> {
    if (files.length === 0) return "failed";
    const fetched = await Promise.all(files.map(fetchAsFile));
    const ready = fetched.filter((file): file is File => file !== undefined);
    if (ready.length === 0) return "failed";

    if (isTouchDevice() && typeof navigator.canShare === "function" && navigator.canShare({ files: ready })) {
        try {
            await navigator.share({ files: ready });
            return ready.length === files.length ? "shared" : "failed";
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
            // NotAllowedError: the tap is too old for the share sheet. Downloading still works.
            console.warn("Share sheet refused, downloading instead", error);
        }
    }

    // Browsers drop downloads started in the same instant: space them out.
    ready.forEach((file, index) => setTimeout(() => downloadFile(file), index * 250));
    return ready.length === files.length ? "downloaded" : "failed";
}
