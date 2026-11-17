import { describe, expect, it } from 'vitest';
import { imageRuleName, imageTokens, separatePictures, sizeFromHeader } from '../ai/pricing/imageTokens';

const cfg = (model: string, endpoint = 'https://gateway.example/v1') => ({ type: 'openai', model, endpoint });

/** A PNG header for a picture of that size, padded to `bytes` so it is as long as a real screenshot. */
const png = (width: number, height: number, bytes = 64) => {
    const head = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
    head.writeUInt32BE(13, 8);
    head.write('IHDR', 12, 'ascii');
    head.writeUInt32BE(width, 16);
    head.writeUInt32BE(height, 20);
    return Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length), 7)]);
};
const jpeg = (width: number, height: number) => {
    const jfif = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14, 1)]);
    const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, sof, Buffer.alloc(100, 2)]);
};
const dataUrl = (bytes: Buffer, type = 'png') => `data:image/${type};base64,${bytes.toString('base64')}`;
const part = (url: string, detail?: string) => ({ type: 'image_url', image_url: { url, ...(detail ? { detail } : {}) } });

describe('reading a picture’s size from its header', () => {
    it('reads PNG, JPEG, GIF and WebP, and nothing else', () => {
        expect(sizeFromHeader(png(1280, 720))).toEqual({ width: 1280, height: 720 });
        expect(sizeFromHeader(jpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 });
        const gif = Buffer.alloc(16);
        gif.write('GIF89a', 0, 'ascii');
        gif.writeUInt16LE(640, 6);
        gif.writeUInt16LE(480, 8);
        expect(sizeFromHeader(gif)).toEqual({ width: 640, height: 480 });
        const webp = Buffer.alloc(40);
        webp.write('RIFF', 0, 'ascii');
        webp.write('WEBP', 8, 'ascii');
        webp.write('VP8X', 12, 'ascii');
        webp.writeUIntLE(1599, 24, 3);
        webp.writeUIntLE(899, 27, 3);
        expect(sizeFromHeader(webp)).toEqual({ width: 1600, height: 900 });
        expect(sizeFromHeader(Buffer.from('not a picture at all, just words'))).toBeNull();
        expect(sizeFromHeader(png(0, 0))).toBeNull();
    });
});

describe('which provider’s rule a model follows', () => {
    it('goes by the model’s own name first (a gateway serves every family), then by the address', () => {
        expect(imageRuleName(cfg('anthropic/claude-sonnet-4.5'))).toBe('claude');
        expect(imageRuleName(cfg('google/gemini-2.5-flash'))).toBe('gemini');
        expect(imageRuleName(cfg('gpt-4o'))).toBe('openai');
        expect(imageRuleName(cfg('openai/gpt-5.4-mini'))).toBe('openai');
        expect(imageRuleName(cfg('qwen3-vl-plus'))).toBe('qwen');
        expect(imageRuleName(cfg('mystery', 'https://api.openai.com/v1'))).toBe('openai');
        expect(imageRuleName(cfg('mystery'))).toBe('other');
    });
});

describe('what one screenshot counts as (R5)', () => {
    const shot = dataUrl(png(1280, 720, 600_000));
    it('is read by OpenAI’s tile rule for a tile model: 85 and 170 a 512 px tile after scaling', () => {
        // 1280x720: no scaling, 3 by 2 tiles
        expect(imageTokens(cfg('gpt-4o'), { url: shot })).toBe(85 + 170 * 6);
        // gpt-4o-mini bills the same tiles at its own base and tile tokens
        expect(imageTokens(cfg('gpt-4o-mini'), { url: shot })).toBe(2833 + 5667 * 6);
        // low detail is the base alone, whatever the size
        expect(imageTokens(cfg('gpt-4o'), { url: shot, detail: 'low' })).toBe(85);
        // a big screenshot: 4096x2048 is scaled to 2048x1024, then to 1536x768: 3 by 2 tiles
        expect(imageTokens(cfg('gpt-4o'), { url: dataUrl(png(4096, 2048)) })).toBe(85 + 170 * 6);
    });

    it('is read by OpenAI’s patch rule for a patch model: 32 px patches times the model’s multiplier', () => {
        // 1280x720 is 40 by 23 patches
        expect(imageTokens(cfg('gpt-5.4'), { url: shot })).toBe(Math.ceil(40 * 23 * 1.2));
        expect(imageTokens(cfg('gpt-4.1-mini'), { url: shot })).toBe(Math.ceil(40 * 23 * 1.62));
        // a picture over the budget is scaled down to it first (gpt-5.4 high: 2,500 patches)
        const huge = imageTokens(cfg('gpt-5.4'), { url: dataUrl(png(6000, 6000)) });
        expect(huge).toBeLessThanOrEqual(Math.ceil(2500 * 1.2));
        expect(huge).toBeGreaterThan(2500);
    });

    it('is read by Claude’s 28 px rule, with its two tiers', () => {
        // 1280x720 is 46 by 26 patches
        expect(imageTokens(cfg('claude-sonnet-4-5'), { url: shot })).toBe(46 * 26);
        // 4K on the standard tier is scaled to fit 1,568 tokens (Anthropic's example: 1,560)
        const standard = imageTokens(cfg('claude-sonnet-4-5'), { url: dataUrl(png(3840, 2160)) });
        expect(standard).toBeLessThanOrEqual(1568);
        expect(standard).toBeGreaterThanOrEqual(1500);
        // on Claude 4.7 and later the same picture may use up to 4,784
        const high = imageTokens(cfg('claude-opus-5'), { url: dataUrl(png(3840, 2160)) });
        expect(high).toBeLessThanOrEqual(4784);
        expect(high).toBeGreaterThan(4500);
    });

    it('is read by Gemini’s rule', () => {
        expect(imageTokens(cfg('gemini-2.5-flash'), { url: dataUrl(png(300, 200)) })).toBe(258);
        // 960x540: crop unit 360, 3 by 2 tiles of 258 (Google's own example: 1,548)
        expect(imageTokens(cfg('gemini-2.5-flash'), { url: dataUrl(png(960, 540)) })).toBe(1548);
        expect(imageTokens(cfg('gemini-3-pro'), { url: shot })).toBe(1120);
    });

    it('is read by Qwen’s rule, and a model nobody knows by the largest rule published', () => {
        expect(imageTokens(cfg('qwen3-vl-plus'), { url: shot })).toBe(40 * 23 + 2);
        expect(imageTokens(cfg('qwen2.5-vl-72b'), { url: shot })).toBe(46 * 26 + 2);
        expect(imageTokens(cfg('mystery-vision'), { url: shot })).toBe(46 * 26);
    });

    it('counts a picture whose size cannot be read as the provider’s documented largest: a link, a file id, a header that is not there', () => {
        expect(imageTokens(cfg('gpt-4o'), { url: 'https://cdn.example/shot.png' })).toBe(85 + 170 * 8);
        expect(imageTokens(cfg('gpt-4o'), { fileId: true })).toBe(85 + 170 * 8);
        expect(imageTokens(cfg('gpt-4o'), { url: 'data:image/png;base64,AAAA' })).toBe(85 + 170 * 8);
        expect(imageTokens(cfg('gpt-4o'), { url: 'https://cdn.example/shot.png', detail: 'low' })).toBe(85);
        expect(imageTokens(cfg('gpt-5.4'), { fileId: true })).toBe(Math.ceil(2500 * 1.2));
        expect(imageTokens(cfg('claude-sonnet-4-5'), { fileId: true })).toBe(1568);
        expect(imageTokens(cfg('claude-opus-5'), { fileId: true })).toBe(4784);
        expect(imageTokens(cfg('gemini-3-pro'), { fileId: true })).toBe(2240);
        expect(imageTokens(cfg('qwen3-vl-plus'), { fileId: true })).toBe(16_384);
    });
});

describe('taking the pictures out of a request', () => {
    it('leaves the words and counts the pictures: inline, linked, and by file id', () => {
        const messages = [
            { role: 'user', content: [{ type: 'text', text: 'Look at this' }, part(dataUrl(png(1280, 720, 600_000))), part('https://cdn.example/a.png'), { type: 'input_image', file_id: 'file-abc' }] },
            { role: 'tool', content: 'plain' },
        ];
        const { rest, imageTokens: counted } = separatePictures(messages, cfg('gpt-4o'));
        expect(counted).toBe(85 + 170 * 6 + (85 + 170 * 8) * 2);
        // The base64 text is gone from what is counted as words
        expect(JSON.stringify(rest)).not.toContain('base64');
        expect(JSON.stringify(rest)).toContain('Look at this');
    });

    it('reads an Anthropic-style base64 source too', () => {
        const messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png(1280, 720).toString('base64') } }] }];
        expect(separatePictures(messages, cfg('claude-sonnet-4-5')).imageTokens).toBe(46 * 26);
    });
});
