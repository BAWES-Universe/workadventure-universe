import type { MatrixClient } from "matrix-js-sdk";

/** Account data where Universe remembers which woka it last saved as the profile picture. */
export const WOKA_AVATAR_ACCOUNT_DATA = "net.bawes.universe.woka_avatar";

export interface SavedWokaAvatar {
    /** SHA-256 of the woka picture that was saved. */
    hash: string;
    /** The profile picture it became. */
    mxc: string;
}

/** The size of the saved picture: the 32px woka scaled 4× with sharp pixels. */
export const WOKA_AVATAR_SIZE = 128;
/** A woka snapshot is one 32px frame; anything bigger is a fallback (a whole sprite sheet) and isn't saved. */
const MAX_WOKA_SIDE = 64;

/**
 * Whether to save the woka as the profile picture. The woka replaces no picture or the one Universe saved before; a
 * picture the person chose in another chat app (Element) stays.
 */
export function shouldSaveWokaAvatar(
    currentAvatar: string | undefined,
    saved: SavedWokaAvatar | undefined,
    wokaHash: string
): boolean {
    if (!currentAvatar) return true;
    if (!saved || currentAvatar !== saved.mxc) return false;
    return saved.hash !== wokaHash;
}

export function parseSavedWokaAvatar(content: unknown): SavedWokaAvatar | undefined {
    if (typeof content !== "object" || content === null) return undefined;
    const { hash, mxc } = content as Record<string, unknown>;
    return typeof hash === "string" && typeof mxc === "string" ? { hash, mxc } : undefined;
}

export async function hashWoka(wokaDataUrl: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(wokaDataUrl));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The woka as a 128px PNG with sharp pixels, or undefined when the picture isn't a woka snapshot. */
export async function renderWokaAvatar(wokaDataUrl: string): Promise<Blob | undefined> {
    if (!wokaDataUrl.startsWith("data:image/")) return undefined;
    const image = new Image();
    image.src = wokaDataUrl;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width === 0 || height === 0 || width > MAX_WOKA_SIDE || height > MAX_WOKA_SIDE) return undefined;

    const canvas = document.createElement("canvas");
    canvas.width = WOKA_AVATAR_SIZE;
    canvas.height = WOKA_AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.imageSmoothingEnabled = false;
    const scale = Math.floor(WOKA_AVATAR_SIZE / Math.max(width, height));
    context.drawImage(
        image,
        Math.round((WOKA_AVATAR_SIZE - width * scale) / 2),
        Math.round((WOKA_AVATAR_SIZE - height * scale) / 2),
        width * scale,
        height * scale
    );
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png");
    });
}

/**
 * Saves the woka as the chat profile picture, so other chat apps and people who aren't in Universe right now see it.
 * Does nothing when it's already saved, or when the person chose their own picture elsewhere.
 */
export async function saveWokaAvatar(client: MatrixClient, wokaDataUrl: string): Promise<void> {
    const userId = client.getUserId();
    if (!userId) return;
    const hash = await hashWoka(wokaDataUrl);
    const saved = parseSavedWokaAvatar(client.getAccountData(WOKA_AVATAR_ACCOUNT_DATA)?.getContent());
    // If the current picture can't be read, nothing is saved: it may be one they chose themselves.
    const profile = await client.getProfileInfo(userId, "avatar_url");
    if (!shouldSaveWokaAvatar(profile.avatar_url, saved, hash)) return;

    const picture = await renderWokaAvatar(wokaDataUrl);
    if (!picture) return;
    const { content_uri: mxc } = await client.uploadContent(picture, { name: "woka.png", type: "image/png" });
    await client.setAvatarUrl(mxc);
    await client.setAccountData(WOKA_AVATAR_ACCOUNT_DATA as never, { hash, mxc } as never);
}
