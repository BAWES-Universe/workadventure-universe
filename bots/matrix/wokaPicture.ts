import axios from 'axios';
import type { BotConfiguration } from '../server/AdminApiService';

/** The size of the chat picture: a 32px Woka frame scaled 4× with sharp pixels, as people's pictures are. */
export const WOKA_PICTURE_SIZE = 128;
/** A Woka frame is 32px; a bigger one is not a Woka sheet and isn't drawn. */
const MAX_FRAME_SIDE = 64;
/** Woka sheets are a few KB; anything far bigger is not one. */
const MAX_SHEET_BYTES = 1024 * 1024;

/** The game's woka list: for each part (woka, body, eyes, ...), collections of textures with their picture. */
export type WokaList = Record<string, { collections?: Array<{ textures?: Array<{ id: string; url: string }> }> } | undefined>;

/**
 * The picture of each texture, bottom first, as absolute URLs (relative ones are the game's, so they resolve against
 * the bot's room). Null when one can't be found: a Woka with a missing layer would be a different Woka.
 */
export function wokaLayerUrls(list: WokaList, textureIds: readonly string[], roomUrl: string): string[] | null {
    const urls: string[] = [];
    for (const id of textureIds) {
        let found: string | undefined;
        for (const part of Object.values(list)) {
            for (const collection of part?.collections ?? []) {
                found = collection.textures?.find((texture) => texture.id === id)?.url;
                if (found) break;
            }
            if (found) break;
        }
        if (!found) return null;
        try {
            urls.push(new URL(found, roomUrl).toString());
        } catch {
            return null;
        }
    }
    return urls;
}

/**
 * The Woka standing and facing you as a 128px PNG: from each 3×4 sheet the middle frame of the top row, drawn over the
 * last, pixel-sharp, on a clear background. The same frame Orbit and the game show. Null when a sheet isn't a Woka.
 */
export async function renderWokaPicture(sheets: readonly Buffer[]): Promise<Buffer | null> {
    if (sheets.length === 0) return null;
    // Loaded only when a picture is drawn: the bot server starts even where the drawing library can't load.
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const canvas = createCanvas(WOKA_PICTURE_SIZE, WOKA_PICTURE_SIZE);
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    for (const sheet of sheets) {
        const image = await loadImage(sheet);
        const width = image.width / 3;
        const height = image.height / 4;
        if (!Number.isInteger(width) || !Number.isInteger(height) || width === 0 || height === 0) return null;
        if (width > MAX_FRAME_SIDE || height > MAX_FRAME_SIDE) return null;
        const scale = Math.floor(WOKA_PICTURE_SIZE / Math.max(width, height));
        context.drawImage(
            image,
            width, 0, width, height,
            Math.round((WOKA_PICTURE_SIZE - width * scale) / 2),
            Math.round((WOKA_PICTURE_SIZE - height * scale) / 2),
            width * scale,
            height * scale
        );
    }
    return canvas.toBuffer('image/png');
}

export interface WokaPictureSources {
    /** The woka list the game uses for this bot in its room. */
    wokaList(roomUrl: string, botId: string): Promise<WokaList | null>;
    /** One layer's sheet. Defaults to a plain download. */
    download?(url: string): Promise<Buffer>;
}

async function downloadSheet(url: string): Promise<Buffer> {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: MAX_SHEET_BYTES });
    return Buffer.from(response.data);
}

/** The bot's Woka as a chat picture, or null when it has none or one of its layers can't be found. */
export async function botWokaPicture(config: BotConfiguration, sources: WokaPictureSources): Promise<Buffer | null> {
    const textureIds = config.characterTextureIds ?? [];
    if (textureIds.length === 0 || !config.roomUrl) return null;
    const list = await sources.wokaList(config.roomUrl, config.botId);
    if (!list) return null;
    const urls = wokaLayerUrls(list, textureIds, config.roomUrl);
    if (!urls) return null;
    const download = sources.download ?? downloadSheet;
    return renderWokaPicture(await Promise.all(urls.map((url) => download(url))));
}
