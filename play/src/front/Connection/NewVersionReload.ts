/** The code the server sends when this page is older than the server and has to be reloaded. */
export const NEW_VERSION_CODE = "NEW_VERSION";

/** How long the "Universe just got an update" screen counts down before reloading on its own. */
export const NEW_VERSION_COUNTDOWN_MS = 10_000;

/** Automatic reloads allowed within the window below; past that, the page waits for the person to press Refresh. */
export const MAX_AUTO_RELOADS = 2;
export const AUTO_RELOAD_WINDOW_MS = 5 * 60_000;

const STORAGE_KEY = "universe.newVersionAutoReloads";

interface ReloadStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function sessionStore(): ReloadStorage | undefined {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
}

function recentReloads(storage: ReloadStorage, now: number): number[] {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (at): at is number => typeof at === "number" && at <= now && now - at < AUTO_RELOAD_WINDOW_MS
        );
    } catch {
        return [];
    }
}

/**
 * Whether the update screen may reload on its own. A reload that still lands on the old version (a cached page)
 * would otherwise loop every few seconds, so after a couple of tries it stops and leaves the Refresh button.
 */
export function canAutoReload(now = Date.now(), storage: ReloadStorage | undefined = sessionStore()): boolean {
    if (!storage) return true;
    return recentReloads(storage, now).length < MAX_AUTO_RELOADS;
}

/** Notes an automatic reload, for canAutoReload. */
export function recordAutoReload(now = Date.now(), storage: ReloadStorage | undefined = sessionStore()): void {
    if (!storage) return;
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify([...recentReloads(storage, now), now]));
    } catch {
        // Storage full or blocked: the reload still happens, only the loop guard is lost.
    }
}
