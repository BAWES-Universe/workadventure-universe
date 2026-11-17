/**
 * What a picture in a request counts as, by the rule of the provider that reads it (R5).
 *
 * A screenshot reaches the relay as a base64 data URL inside the messages. Counting its text (bytes / 3) would read a 600 KB screenshot as
 * 200,000 tokens; no provider bills that. Each provider has its own published rule, from the picture's size in pixels. The size is read from the
 * picture's own header (never the whole picture, never a download). A picture whose size cannot be read (a remote link, a file id, a header that is
 * not there) counts as the provider's documented largest, so a hold is never smaller than the bill.
 *
 * Rules as the providers publish them (checked 18 Nov 2026):
 *  - OpenAI, patch models (gpt-5.2 and later, gpt-4.1-mini/nano, o4-mini, gpt-5-mini/nano): 32 px patches, a budget per detail level, a multiplier per model.
 *  - OpenAI, tile models (gpt-4o, gpt-4o-mini, gpt-4.1, gpt-5, gpt-5.1, o1/o3): base + tiles of 512 px after scaling to 2048 and then to 768 on the short side.
 *  - Claude: 28 px patches; long edge 1568 and 1568 tokens at most (Claude 4.7 and later: 2576 and 4784).
 *  - Gemini 3: 1120 tokens a picture (2240 at the highest setting); earlier Gemini: 258 for 384 px or less, else 258 for each tile.
 *  - Qwen vision: one token for each 32 px (28 px on Qwen2.5-VL / QVQ) square plus 2, at most 16,384.
 *  - DeepSeek vision: 384 at most.
 * Anything else: the 28 px rule, at most 16,384 (the largest published ceiling).
 */
import type { PricedConfig } from './costing';

export interface ImageSize {
    width: number;
    height: number;
}

export type ImageRuleName = 'openai' | 'claude' | 'gemini' | 'qwen' | 'deepseek' | 'other';

/** The largest any provider documents for one picture, for a provider whose own rule is not known. */
const OTHER_LARGEST = 16_384;

export function imageRuleName(config: PricedConfig): ImageRuleName {
    const model = (config.model ?? '').toLowerCase();
    const host = (() => {
        try {
            return new URL(config.endpoint || '').hostname;
        } catch {
            return '';
        }
    })();
    // The model's own name decides first: a gateway (OpenRouter) serves every family under one address
    if (/claude/.test(model)) return 'claude';
    if (/gemini/.test(model)) return 'gemini';
    if (/(^|[/:\-_])(gpt|o1|o3|o4|chatgpt)/.test(model)) return 'openai';
    if (/qwen|qvq/.test(model)) return 'qwen';
    if (/deepseek/.test(model)) return 'deepseek';
    if (host === 'api.anthropic.com') return 'claude';
    if (host === 'generativelanguage.googleapis.com') return 'gemini';
    if (host === 'api.openai.com') return 'openai';
    if (/dashscope|aliyuncs/.test(host)) return 'qwen';
    return 'other';
}

// ---------------------------------------------------------------- reading a picture's size

/** The first bytes of a base64 text, decoded: enough for any header, never the whole picture. */
const HEADER_BASE64_CHARS = 128 * 1024;

function bytesOfDataUrl(url: string): Buffer | null {
    const match = /^data:image\/[a-z0-9.+-]+(;[^,]*)?;base64,/i.exec(url);
    if (!match) return null;
    const start = match[0].length;
    // A prefix whose length is a multiple of 4 decodes on its own
    const end = start + Math.min(url.length - start, HEADER_BASE64_CHARS);
    const length = end === url.length ? end - start : Math.floor((end - start) / 4) * 4;
    try {
        return Buffer.from(url.slice(start, start + length), 'base64');
    } catch {
        return null;
    }
}

/** The width and height written in a PNG, JPEG, GIF or WebP header. Null when it is none of them or the header is cut. */
export function sizeFromHeader(bytes: Buffer): ImageSize | null {
    const size = (width: number, height: number): ImageSize | null => (width > 0 && height > 0 ? { width, height } : null);
    // PNG: signature, then the IHDR chunk with width and height as 32-bit numbers
    if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString('ascii', 12, 16) === 'IHDR') {
        return size(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
    }
    // GIF: 16-bit little-endian width and height after the 6-byte signature
    if (bytes.length >= 10 && bytes.toString('ascii', 0, 3) === 'GIF') return size(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    // WebP
    if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
        const kind = bytes.toString('ascii', 12, 16);
        if (kind === 'VP8X') return size(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
        if (kind === 'VP8L' && bytes[20] === 0x2f) {
            const bits = bytes.readUInt32LE(21);
            return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
        }
        if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return size(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
        return null;
    }
    // JPEG: walk the segments to the first frame header (SOF)
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let at = 2;
        while (at + 4 <= bytes.length) {
            if (bytes[at] !== 0xff) return null;
            const marker = bytes[at + 1];
            if (marker === 0xff) {
                at += 1;
                continue;
            }
            // Markers with no length
            if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
                at += 2;
                continue;
            }
            const length = bytes.readUInt16BE(at + 2);
            const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
            if (isFrame) return at + 9 <= bytes.length ? size(bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)) : null;
            if (length < 2) return null;
            at += 2 + length;
        }
    }
    return null;
}

// ---------------------------------------------------------------- the rules

const patches = (size: ImageSize, patch: number) => Math.ceil(size.width / patch) * Math.ceil(size.height / patch);

/** Scales a size down (never up) so its long side is at most `edge` and it needs at most `budget` patches of `patch` px, keeping its shape. */
function fitPatches(size: ImageSize, patch: number, edge: number, budget: number): ImageSize {
    const long = Math.max(size.width, size.height);
    let scale = long > edge ? edge / long : 1;
    const at = (factor: number): ImageSize => ({ width: Math.max(1, Math.floor(size.width * factor)), height: Math.max(1, Math.floor(size.height * factor)) });
    if (patches(at(scale), patch) > budget) {
        scale = Math.min(scale, Math.sqrt((budget * patch * patch) / (size.width * size.height)));
        // Rounding can leave an edge one patch over: a little smaller each time, until it fits (the size a provider would reach)
        for (let guard = 0; patches(at(scale), patch) > budget && guard < 2000; guard++) scale *= 0.999;
    }
    return at(scale);
}

interface OpenAIRule {
    kind: 'tile' | 'patch';
    base?: number;
    tile?: number;
    multiplier?: number;
    /** Budget and long edge for each detail level (patch models); `auto` is the one used when none is said. */
    levels?: Record<'low' | 'high' | 'original', { budget: number; edge: number }>;
    auto?: 'low' | 'high' | 'original';
}

const LEVELS_FIXED_6144 = { low: { budget: 6144, edge: 2048 }, high: { budget: 6144, edge: 2048 }, original: { budget: 6144, edge: 2048 } } as const;
const LEVELS_54 = { low: { budget: 6144, edge: 2048 }, high: { budget: 2500, edge: 2048 }, original: { budget: 10_000, edge: 6000 } } as const;
const LEVELS_55 = { low: { budget: 256, edge: 512 }, high: { budget: 2500, edge: 2048 }, original: { budget: 10_000, edge: 6000 } } as const;
const LEVELS_56 = { low: { budget: 256, edge: 512 }, high: { budget: 2500, edge: 2048 }, original: { budget: 30_000, edge: 65_535 } } as const;

/** OpenAI's rule for a model name. A name nobody knows is read by the newest rule (the most a patch model bills). */
function openAIRule(model: string): OpenAIRule {
    const m = model.toLowerCase().replace(/^.*[/:]/, '');
    if (/gpt-4o-mini/.test(m)) return { kind: 'tile', base: 2833, tile: 5667 };
    if (/^(o1|o3)/.test(m)) return { kind: 'tile', base: 75, tile: 150 };
    if (/gpt-4o|chatgpt-4o/.test(m)) return { kind: 'tile', base: 85, tile: 170 };
    if (/gpt-4\.1-mini/.test(m)) return { kind: 'patch', multiplier: 1.62, levels: LEVELS_FIXED_6144, auto: 'high' };
    if (/gpt-4\.1-nano/.test(m)) return { kind: 'patch', multiplier: 2.46, levels: LEVELS_FIXED_6144, auto: 'high' };
    if (/gpt-4\.1/.test(m)) return { kind: 'tile', base: 85, tile: 170 };
    if (/^o4-mini/.test(m)) return { kind: 'patch', multiplier: 1.72, levels: LEVELS_FIXED_6144, auto: 'high' };
    if (/gpt-5-nano/.test(m)) return { kind: 'patch', multiplier: 1.5, levels: LEVELS_FIXED_6144, auto: 'high' };
    if (/gpt-5-mini/.test(m)) return { kind: 'patch', multiplier: 1.2, levels: LEVELS_FIXED_6144, auto: 'high' };
    if (/gpt-5\.1|^gpt-5($|-(?!mini|nano))/.test(m)) return { kind: 'tile', base: 70, tile: 140 };
    if (/gpt-5\.2/.test(m)) return { kind: 'patch', multiplier: 1.2, levels: LEVELS_FIXED_6144, auto: 'high' };
    if (/gpt-5\.4/.test(m)) return { kind: 'patch', multiplier: 1.2, levels: LEVELS_54, auto: 'high' };
    if (/gpt-5\.5/.test(m)) return { kind: 'patch', multiplier: 1.2, levels: LEVELS_55, auto: 'original' };
    return { kind: 'patch', multiplier: 1.2, levels: LEVELS_56, auto: 'original' };
}

const levelOf = (rule: OpenAIRule, detail: string | undefined): 'low' | 'high' | 'original' =>
    detail === 'low' || detail === 'high' || detail === 'original' ? detail : rule.auto ?? 'high';

/** The most one picture is billed on an OpenAI model (a picture of the largest size the rule allows). */
function openAILargest(rule: OpenAIRule, detail: string | undefined): number {
    if (rule.kind === 'tile') {
        if (detail === 'low') return rule.base!;
        // After scaling, the largest picture is 2048 by 768: 4 by 2 tiles
        return rule.base! + rule.tile! * 8;
    }
    return Math.ceil(rule.levels![levelOf(rule, detail)].budget * rule.multiplier!);
}

function openAITokens(rule: OpenAIRule, size: ImageSize | null, detail: string | undefined): number {
    if (!size) return openAILargest(rule, detail);
    if (rule.kind === 'tile') {
        if (detail === 'low') return rule.base!;
        let { width, height } = size;
        const long = Math.max(width, height);
        if (long > 2048) {
            width = (width * 2048) / long;
            height = (height * 2048) / long;
        }
        const short = Math.min(width, height);
        if (short > 768) {
            width = (width * 768) / short;
            height = (height * 768) / short;
        }
        return rule.base! + rule.tile! * Math.ceil(width / 512) * Math.ceil(height / 512);
    }
    const level = rule.levels![levelOf(rule, detail)];
    const fitted = fitPatches(size, 32, level.edge, level.budget);
    // A picture over the 30,000-patch limit is refused by the provider: it counts at the limit
    return Math.ceil(Math.min(30_000, patches(fitted, 32)) * rule.multiplier!);
}

const isHighResolutionClaude = (model: string): boolean => {
    const m = model.toLowerCase();
    // Claude 4.7 and later, and the 5 family (Fable, Opus 5, Sonnet 5, Haiku 5): the higher tier. A name that cannot be told apart takes the higher tier too.
    const versioned = /(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d+))?/.exec(m);
    if (!versioned) return true;
    const major = Number(versioned[1]);
    const minor = Number(versioned[2] ?? 0);
    return major > 4 || (major === 4 && minor >= 7);
};

function claudeTokens(model: string, size: ImageSize | null): number {
    const high = isHighResolutionClaude(model);
    const edge = high ? 2576 : 1568;
    const cap = high ? 4784 : 1568;
    if (!size) return cap;
    const fitted = fitPatches(size, 28, edge, cap);
    return Math.min(cap, patches(fitted, 28));
}

function geminiTokens(model: string, size: ImageSize | null): number {
    // Gemini 3 and later: a set number a picture, 1120 by default and 2240 at the highest setting
    const major = /gemini-(\d+)/.exec(model.toLowerCase());
    if (major && Number(major[1]) >= 3) return size ? 1120 : 2240;
    if (!size) {
        // No size, and Google documents no ceiling for the tile rule: 6 by 6 tiles (a screen of about 4,600 px each way) stands for the largest, read high on purpose
        return 258 * 6 * 6;
    }
    if (size.width <= 384 && size.height <= 384) return 258;
    const unit = Math.max(1, Math.floor(Math.min(size.width, size.height) / 1.5));
    return 258 * Math.ceil(size.width / unit) * Math.ceil(size.height / unit);
}

function qwenTokens(model: string, size: ImageSize | null): number {
    if (!size) return OTHER_LARGEST;
    const patch = /qwen2(\.5)?-vl|qvq/.test(model.toLowerCase()) ? 28 : 32;
    return Math.min(OTHER_LARGEST, patches(size, patch) + 2);
}

export interface ImageRef {
    url?: string;
    /** A file id or a remote link has no readable size here. */
    fileId?: boolean;
    detail?: string;
}

/** Tokens for one picture, by the rule of the provider the model belongs to. */
export function imageTokens(config: PricedConfig, image: ImageRef): number {
    const model = config.model ?? '';
    const size = image.url && !image.fileId ? (() => {
        const bytes = bytesOfDataUrl(image.url!);
        return bytes ? sizeFromHeader(bytes) : null;
    })() : null;
    switch (imageRuleName(config)) {
        case 'openai':
            return openAITokens(openAIRule(model), size, image.detail);
        case 'claude':
            return claudeTokens(model, size);
        case 'gemini':
            return geminiTokens(model, size);
        case 'qwen':
            return qwenTokens(model, size);
        case 'deepseek':
            return 384;
        default:
            return size ? Math.min(OTHER_LARGEST, patches(size, 28)) : OTHER_LARGEST;
    }
}

// ---------------------------------------------------------------- finding the pictures in a request

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The picture a content part holds, when it is one (chat completions `image_url`, responses `input_image`, Anthropic-style `image`). */
function imageOf(part: Record<string, unknown>): ImageRef | null {
    const type = part.type;
    if (type !== 'image_url' && type !== 'input_image' && type !== 'image') return null;
    const holder = isRecord(part.image_url) ? part.image_url : part;
    let url = typeof holder.url === 'string' ? holder.url : typeof part.image_url === 'string' ? part.image_url : undefined;
    let fileId = typeof holder.file_id === 'string' || typeof part.file_id === 'string' || (isRecord(part.source) && part.source.type === 'file');
    const source = isRecord(part.source) ? part.source : null;
    if (source && source.type === 'base64' && typeof source.data === 'string') {
        url = `data:${typeof source.media_type === 'string' ? source.media_type : 'image/png'};base64,${source.data}`;
        fileId = false;
    }
    const detail = typeof holder.detail === 'string' ? holder.detail : typeof part.detail === 'string' ? part.detail : undefined;
    // Only an inline picture has a readable size: a remote link or a file id is read at the largest
    if (url && !/^data:/i.test(url)) fileId = true;
    return { ...(url ? { url } : {}), ...(fileId ? { fileId: true } : {}), ...(detail ? { detail } : {}) };
}

/**
 * The messages with every picture taken out, and what the pictures count as. The text that is left is counted by its bytes; the pictures by the
 * provider's rule: a screenshot's base64 text is never counted as if it were words.
 */
export function separatePictures(messages: unknown, config: PricedConfig): { rest: unknown; imageTokens: number } {
    let total = 0;
    if (!Array.isArray(messages)) return { rest: messages, imageTokens: 0 };
    const strip = (value: unknown, depth: number): unknown => {
        if (Array.isArray(value)) return value.map((entry) => strip(entry, depth + 1));
        if (!isRecord(value) || depth > 6) return value;
        const image = imageOf(value);
        if (image) {
            total += imageTokens(config, image);
            return { type: value.type };
        }
        const copy: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value)) copy[key] = Array.isArray(inner) || isRecord(inner) ? strip(inner, depth + 1) : inner;
        return copy;
    };
    return { rest: strip(messages, 0), imageTokens: total };
}
