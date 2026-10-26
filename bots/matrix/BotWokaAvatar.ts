import { createHash } from 'crypto';
import type { MatrixAppServiceClient } from './MatrixAppServiceClient';
import type { BotConfiguration } from '../server/AdminApiService';

/** Account data where the bot server remembers which Woka it last saved as a bot's chat picture (as the game does for people). */
export const WOKA_AVATAR_ACCOUNT_DATA = 'net.bawes.universe.woka_avatar';

export interface SavedWokaAvatar {
    /** SHA-256 of the Woka's layers that were saved. */
    hash: string;
    /** The chat picture it became. */
    mxc: string;
    /** The picture saved before it, until the new one is set on the profile. */
    previous?: string;
}

type AvatarClient = Pick<MatrixAppServiceClient, 'getAvatarUrl' | 'setAvatarUrl' | 'getAccountData' | 'setAccountData' | 'uploadMedia'>;

/**
 * Whether to save the Woka as the chat picture. It replaces no picture or one saved here before; a picture set some
 * other way (an admin in Element) stays. The same rule as people's pictures (play MatrixWokaAvatar.ts).
 */
export function shouldSaveWokaAvatar(current: string | null, saved: SavedWokaAvatar | undefined, hash: string): boolean {
    if (!current) return true;
    if (!saved) return false;
    if (current === saved.mxc) return saved.hash !== hash;
    // The last save was cut off before the picture was set: the profile still shows the one saved before it.
    return current === saved.previous;
}

export function parseSavedWokaAvatar(content: unknown): SavedWokaAvatar | undefined {
    if (typeof content !== 'object' || content === null) return undefined;
    const { hash, mxc, previous } = content as Record<string, unknown>;
    if (typeof hash !== 'string' || typeof mxc !== 'string') return undefined;
    return typeof previous === 'string' ? { hash, mxc, previous } : { hash, mxc };
}

/** What identifies a Woka: its layers, in order. */
export function wokaHash(textureIds: readonly string[]): string {
    return createHash('sha256').update(`layers:${textureIds.join('\n')}`).digest('hex');
}

/**
 * Keeps each bot's chat picture its Woka. Checked whenever the bot's chat account is used; the homeserver is asked only
 * once per bot and Woka in this process, and a picture is drawn and uploaded only when the Woka changed.
 */
export class BotWokaAvatar {
    /** The Woka each bot's picture is known to match (or that could not be drawn), so it isn't checked again. */
    private settled = new Map<string, string>();
    private running = new Map<string, Promise<void>>();

    constructor(
        private client: AvatarClient,
        private draw: (config: BotConfiguration) => Promise<Buffer | null>
    ) {}

    /** Brings the picture up to date in the background. Never throws: a failure is logged and tried again next time. */
    update(userId: string, config: BotConfiguration): Promise<void> {
        const textureIds = config.characterTextureIds ?? [];
        if (textureIds.length === 0) return Promise.resolve();
        const hash = wokaHash(textureIds);
        if (this.settled.get(config.botId) === hash) return Promise.resolve();
        const running = this.running.get(config.botId);
        if (running) return running;
        const run = this.save(userId, config, hash)
            .then(() => void this.settled.set(config.botId, hash))
            .catch((error) =>
                console.warn(`[BotWokaAvatar] Could not set the chat picture of bot ${config.botId}:`, error?.message ?? error)
            )
            .finally(() => this.running.delete(config.botId));
        this.running.set(config.botId, run);
        return run;
    }

    private async save(userId: string, config: BotConfiguration, hash: string): Promise<void> {
        const current = await this.client.getAvatarUrl(userId);
        const saved = parseSavedWokaAvatar(await this.client.getAccountData(userId, WOKA_AVATAR_ACCOUNT_DATA));
        if (!shouldSaveWokaAvatar(current, saved, hash)) return;
        // A Woka that can't be drawn (a layer removed from the catalog) keeps the picture it has, until the Woka changes.
        const picture = await this.draw(config);
        if (!picture) return;
        const mxc = await this.client.uploadMedia(userId, picture, 'image/png', 'woka.png');
        if (!mxc) throw new Error('the homeserver gave no address for the picture');
        const record: SavedWokaAvatar = current ? { hash, mxc, previous: current } : { hash, mxc };
        await this.client.setAccountData(userId, WOKA_AVATAR_ACCOUNT_DATA, record);
        await this.client.setAvatarUrl(userId, mxc);
    }
}
