import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { BotWokaAvatar, WOKA_AVATAR_ACCOUNT_DATA, shouldSaveWokaAvatar, wokaHash } from '../matrix/BotWokaAvatar';
import { WOKA_PICTURE_SIZE, botWokaPicture, renderWokaPicture, wokaLayerUrls, type WokaList } from '../matrix/wokaPicture';

const BOT = '0b7c1d2e-1111-4222-8333-944455556666';
const BOT_USER = `@bot_${BOT}:matrix.test`;
const ROOM_URL = 'https://play.test/_/u/w/map.tmj';

const bot = (characterTextureIds: string[] = ['male1']): any => ({ botId: BOT, name: 'Guide', roomUrl: ROOM_URL, characterTextureIds });

/** A 3×4 Woka sheet of 32px frames: every frame `rest`, the standing front frame (middle of the top row) `front`. */
function sheet(front: string, rest = '#0000ff', frame = 32, mark?: { x: number; y: number; colour: string }): Buffer {
    const canvas = createCanvas(frame * 3, frame * 4);
    const context = canvas.getContext('2d');
    context.fillStyle = rest;
    context.fillRect(0, 0, frame * 3, frame * 4);
    context.clearRect(frame, 0, frame, frame);
    if (front) {
        context.fillStyle = front;
        context.fillRect(frame, 0, frame, frame);
    }
    if (mark) {
        context.fillStyle = mark.colour;
        context.fillRect(frame + mark.x, mark.y, 1, 1);
    }
    return canvas.toBuffer('image/png');
}

async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
    const image = await loadImage(png);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(x, y, 1, 1).data);
}

describe('renderWokaPicture', () => {
    it('draws the standing front frame at 128px with sharp pixels', async () => {
        const png = (await renderWokaPicture([sheet('#ff0000')]))!;
        const image = await loadImage(png);
        expect([image.width, image.height]).toEqual([WOKA_PICTURE_SIZE, WOKA_PICTURE_SIZE]);
        expect(await pixel(png, 64, 64)).toEqual([255, 0, 0, 255]);
        expect(await pixel(png, 0, 0)).toEqual([255, 0, 0, 255]);
    });

    it('stacks the layers bottom first', async () => {
        // The top layer is clear except one pixel, which lands as a sharp 4×4 block over the bottom layer.
        const png = (await renderWokaPicture([sheet('#ff0000'), sheet('', '#0000ff', 32, { x: 10, y: 20, colour: '#00ff00' })]))!;
        expect(await pixel(png, 41, 81)).toEqual([0, 255, 0, 255]);
        expect(await pixel(png, 44, 81)).toEqual([255, 0, 0, 255]);
        expect(await pixel(png, 64, 64)).toEqual([255, 0, 0, 255]);
    });

    it('draws nothing for a picture that is not a Woka sheet', async () => {
        expect(await renderWokaPicture([sheet('#ff0000', '#0000ff', 80)])).toBeNull();
        const odd = createCanvas(100, 128).toBuffer('image/png');
        expect(await renderWokaPicture([odd])).toBeNull();
        expect(await renderWokaPicture([])).toBeNull();
    });
});

describe('wokaLayerUrls', () => {
    const list: WokaList = {
        woka: { collections: [{ textures: [{ id: 'male1', url: 'resources/characters/pipoya/Male 01-1.png' }] }] },
        body: { collections: [{ textures: [{ id: 'body1', url: 'https://cdn.test/body1.png' }] }] },
        hat: { collections: [] },
    };

    it('finds each texture in any part, in order, and resolves the game\'s own paths against its root', () => {
        expect(wokaLayerUrls(list, ['body1', 'male1'], ROOM_URL)).toEqual([
            'https://cdn.test/body1.png',
            'https://play.test/resources/characters/pipoya/Male%2001-1.png',
        ]);
    });

    it('gives nothing when a layer is missing, rather than a different Woka', () => {
        expect(wokaLayerUrls(list, ['male1', 'gone'], ROOM_URL)).toBeNull();
    });
});

describe('botWokaPicture', () => {
    it('asks for the bot picker list of its room and draws the layers', async () => {
        const wokaList = vi.fn(async () => ({ woka: { collections: [{ textures: [{ id: 'male1', url: 'https://cdn.test/m.png' }] }] } }));
        const download = vi.fn(async () => sheet('#ff0000'));
        const png = await botWokaPicture(bot(), { wokaList, download });
        expect(wokaList).toHaveBeenCalledWith(ROOM_URL, BOT);
        expect(download).toHaveBeenCalledWith('https://cdn.test/m.png');
        expect(await pixel(png!, 64, 64)).toEqual([255, 0, 0, 255]);
    });

    it('does not look anything up for a bot without a Woka', async () => {
        const wokaList = vi.fn();
        expect(await botWokaPicture(bot([]), { wokaList })).toBeNull();
        expect(wokaList).not.toHaveBeenCalled();
    });
});

describe('shouldSaveWokaAvatar', () => {
    const hash = wokaHash(['male1']);
    it('follows the people rule: no picture or our own, never one set some other way', () => {
        expect(shouldSaveWokaAvatar(null, undefined, hash)).toBe(true);
        expect(shouldSaveWokaAvatar('mxc://x/theirs', undefined, hash)).toBe(false);
        expect(shouldSaveWokaAvatar('mxc://x/ours', { hash, mxc: 'mxc://x/ours' }, hash)).toBe(false);
        expect(shouldSaveWokaAvatar('mxc://x/ours', { hash: 'old', mxc: 'mxc://x/ours' }, hash)).toBe(true);
        expect(shouldSaveWokaAvatar('mxc://x/before', { hash, mxc: 'mxc://x/ours', previous: 'mxc://x/before' }, hash)).toBe(true);
        expect(shouldSaveWokaAvatar('mxc://x/theirs', { hash, mxc: 'mxc://x/ours' }, hash)).toBe(false);
    });
});

describe('BotWokaAvatar', () => {
    let client: any;
    let draw: any;
    let avatars: BotWokaAvatar;
    let calls: string[];

    beforeEach(() => {
        calls = [];
        const accountData = new Map<string, unknown>();
        let avatar: string | null = null;
        client = {
            getAvatarUrl: vi.fn(async () => avatar),
            setAvatarUrl: vi.fn(async (_user: string, mxc: string) => {
                calls.push('avatar');
                avatar = mxc;
            }),
            getAccountData: vi.fn(async (_user: string, type: string) => accountData.get(type)),
            setAccountData: vi.fn(async (_user: string, type: string, content: unknown) => {
                calls.push('account data');
                accountData.set(type, content);
            }),
            uploadMedia: vi.fn(async () => {
                calls.push('upload');
                return `mxc://matrix.test/woka${calls.length}`;
            }),
            setAvatar: (mxc: string | null) => (avatar = mxc),
        };
        draw = vi.fn(async () => Buffer.from('png'));
        avatars = new BotWokaAvatar(client, draw);
    });

    it('saves the Woka as the picture of a bot that has none, and remembers it before setting it', async () => {
        await avatars.update(BOT_USER, bot());
        expect(client.uploadMedia).toHaveBeenCalledWith(BOT_USER, Buffer.from('png'), 'image/png', 'woka.png');
        expect(calls).toEqual(['upload', 'account data', 'avatar']);
        expect(client.setAccountData).toHaveBeenCalledWith(BOT_USER, WOKA_AVATAR_ACCOUNT_DATA, {
            hash: wokaHash(['male1']),
            mxc: 'mxc://matrix.test/woka1',
        });
        expect(client.setAvatarUrl).toHaveBeenCalledWith(BOT_USER, 'mxc://matrix.test/woka1');
    });

    it('asks the homeserver only once per Woka, and draws again only when the Woka changes', async () => {
        await avatars.update(BOT_USER, bot());
        await avatars.update(BOT_USER, bot());
        // Once before drawing, once before setting the picture.
        expect(client.getAvatarUrl).toHaveBeenCalledTimes(2);
        expect(draw).toHaveBeenCalledTimes(1);

        await avatars.update(BOT_USER, bot(['female1']));
        expect(draw).toHaveBeenCalledTimes(2);
        expect(client.setAccountData).toHaveBeenLastCalledWith(BOT_USER, WOKA_AVATAR_ACCOUNT_DATA, {
            hash: wokaHash(['female1']),
            mxc: 'mxc://matrix.test/woka4',
            previous: 'mxc://matrix.test/woka1',
        });
    });

    it('does not draw again after a restart when the saved picture is still this Woka', async () => {
        await avatars.update(BOT_USER, bot());
        const restarted = new BotWokaAvatar(client, draw);
        await restarted.update(BOT_USER, bot());
        expect(draw).toHaveBeenCalledTimes(1);
    });

    it('leaves a picture set some other way', async () => {
        client.setAvatar('mxc://matrix.test/chosen');
        await avatars.update(BOT_USER, bot());
        expect(draw).not.toHaveBeenCalled();
        expect(client.setAvatarUrl).not.toHaveBeenCalled();
    });

    it('keeps a picture an admin set while the Woka was being drawn and uploaded', async () => {
        client.uploadMedia.mockImplementationOnce(async () => {
            client.setAvatar('mxc://matrix.test/chosen');
            return 'mxc://matrix.test/woka1';
        });
        await avatars.update(BOT_USER, bot());
        expect(client.setAccountData).not.toHaveBeenCalled();
        expect(client.setAvatarUrl).not.toHaveBeenCalled();
    });

    it('does nothing for a bot without a Woka', async () => {
        await avatars.update(BOT_USER, bot([]));
        expect(client.getAvatarUrl).not.toHaveBeenCalled();
    });

    it('never throws, and tries again next time after a failure', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        client.uploadMedia.mockRejectedValueOnce(new Error('homeserver busy'));
        await expect(avatars.update(BOT_USER, bot())).resolves.toBeUndefined();
        expect(client.setAvatarUrl).not.toHaveBeenCalled();
        await avatars.update(BOT_USER, bot());
        expect(client.setAvatarUrl).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('draws once when several messages arrive together', async () => {
        await Promise.all([avatars.update(BOT_USER, bot()), avatars.update(BOT_USER, bot()), avatars.update(BOT_USER, bot())]);
        expect(draw).toHaveBeenCalledTimes(1);
        expect(client.uploadMedia).toHaveBeenCalledTimes(1);
    });

    it('keeps the picture it has when the Woka cannot be drawn', async () => {
        draw.mockResolvedValueOnce(null);
        await avatars.update(BOT_USER, bot());
        expect(client.uploadMedia).not.toHaveBeenCalled();
        await avatars.update(BOT_USER, bot());
        expect(draw).toHaveBeenCalledTimes(1);
    });
});
