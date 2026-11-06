/**
 * How many things one call of a tool makes, and how many a request has made so far (game #1662, mock 5 approved 4 Nov 2026).
 *
 * A tool under "Makes new things" runs right away until a request would make more than the bot's "Asks before making more
 * than" number. Then one card shows the total and one tap makes the lot. The number is only ever read from what the tool
 * declares about its own inputs: a count (`n`, `num_images`), a list (`prompts`) or a number of variations. A tool that
 * declares nothing about how many it makes is not guessed at: it asks every time while a limit is set.
 *
 * Pure apart from MakeCounts, which is the small memory of "so far in this request".
 */

export type Quantity =
    /** The call makes this many, named by `unit` ("images"). */
    | { known: true; count: number; unit: string; names: { one: string; many: string } }
    /** The tool does not say how many one call makes. `unreadable` when the call did give a count that is not a usable number. */
    | { known: false; unit: string; unreadable?: boolean };

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A key reduced to its letters and digits, lower case: "num_images" and "numImages" are the same key. */
const squash = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Keys that name how many to make. */
const COUNT_KEY = /^(n|count|quantity|qty|batchsize|numimages|numoutputs|numresults|numitems|numtracks|numsongs|numvideos|numsamples|numgenerations|numfiles|numcopies|numberof(images|outputs|results|items|tracks|songs|videos|samples|generations|files|copies|posters|pictures|logos|icons|drafts|documents|slides|designs|clips)|nsamples|nimages|copies|imagecount|outputcount|trackcount)$/;
/** Keys that name how many versions of each to make: they multiply. */
const TIMES_KEY = /^(variants|variations|versions|numvariants|numvariations|numversions|numberofvariations|numberofvariants|numberofversions|outputsperprompt|samplesperprompt|imagesperprompt|perprompt)$/;
/** Keys that hold a list with one thing made for each entry. Only names that mean "one each": a list of items or topics may as well make one thing from them all. */
const LIST_KEY = /^(prompts|descriptions|lyrics|captions|ideas)$/;

/** What the things are called, for the title ("Make 12 images"). The first one found in the key, then the tool's name, then its title. */
const NOUNS: Array<[RegExp, string, string]> = [
    [/^(?:image|picture|pic|photo|render)s?$/, 'image', 'images'],
    [/^(?:poster)s?$/, 'poster', 'posters'],
    [/^(?:logo)s?$/, 'logo', 'logos'],
    [/^(?:icon)s?$/, 'icon', 'icons'],
    [/^(?:illustration|drawing)s?$/, 'illustration', 'illustrations'],
    [/^(?:sticker)s?$/, 'sticker', 'stickers'],
    [/^(?:avatar)s?$/, 'avatar', 'avatars'],
    [/^(?:thumbnail)s?$/, 'thumbnail', 'thumbnails'],
    [/^(?:banner)s?$/, 'banner', 'banners'],
    [/^(?:track|song|jingle|music|tune)s?$/, 'track', 'tracks'],
    [/^(?:video|clip|animation)s?$/, 'video', 'videos'],
    [/^(?:audio|sound|voice|speech)s?$/, 'audio file', 'audio files'],
    [/^(?:slide|deck)s?$/, 'slide', 'slides'],
    [/^(?:document|doc|draft|report)s?$/, 'document', 'documents'],
    [/^(?:file)s?$/, 'file', 'files'],
    [/^(?:design|mockup)s?$/, 'design', 'designs'],
];

function wordsOf(text: string): string {
    return text
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .toLowerCase();
}

/** The first noun in these words, in the order they are said. */
function nounIn(words: string[]): { one: string; many: string } | null {
    for (const word of words) {
        for (const [pattern, one, many] of NOUNS) {
            if (pattern.test(word)) return { one, many };
        }
    }
    return null;
}

/**
 * The things' name in the singular and plural, or the plain "thing(s)" when nothing in the names says. A name that says
 * what goes in and what comes out ("image_to_video") is read for what comes out: the words after the last "to".
 */
export function unitNames(...sources: Array<string | undefined>): { one: string; many: string } {
    for (const source of sources) {
        if (!source) continue;
        const words = wordsOf(source).split(' ');
        const toAt = Math.max(words.lastIndexOf('to'), words.lastIndexOf('into'));
        const found = (toAt >= 0 ? nounIn(words.slice(toAt + 1)) : null) ?? nounIn(words);
        if (found) return found;
    }
    return { one: 'thing', many: 'things' };
}

export const unitFor = (count: number, names: { one: string; many: string }) => (count === 1 ? names.one : names.many);

/** A whole number from a number or a numeric string, else null. A fraction, a negative or a huge value is not a count. */
function wholeNumber(value: unknown): number | null {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || !Number.isInteger(number) || number < 0 || number > 100_000) return null;
    return number;
}

/**
 * How many one call makes, from what the tool declares about its inputs and the arguments of this call. A count that was
 * left out takes the tool's own default; with no default it is not known. Nothing is read from the words of a prompt.
 */
export function quantityOf(toolName: string, toolTitle: string | undefined, args: Record<string, unknown>, inputSchema: unknown): Quantity {
    const properties = isPlain(inputSchema) && isPlain(inputSchema.properties) ? inputSchema.properties : {};
    const declared = Object.keys(properties);
    let list: number | null = null;
    let count: number | null = null;
    let times: number | null = null;
    let found = false;
    let unitKey: string | undefined;
    let unknownCount = false;
    let unreadable = false;

    // A key the tool declares or the call sent, whichever is there
    const keys = [...new Set([...declared, ...Object.keys(args)])];
    for (const key of keys) {
        const flat = squash(key);
        const schema = isPlain(properties[key]) ? (properties[key] as Record<string, unknown>) : undefined;
        if (LIST_KEY.test(flat) && (schema?.type === 'array' || Array.isArray(args[key]))) {
            if (Array.isArray(args[key])) {
                list = (list ?? 1) * Math.max(0, (args[key] as unknown[]).length);
                found = true;
                unitKey ??= key;
            }
            continue;
        }
        const isCount = COUNT_KEY.test(flat);
        const isTimes = TIMES_KEY.test(flat);
        if (!isCount && !isTimes) continue;
        if (!(key in args) || args[key] === undefined || args[key] === null) {
            // Left out: the tool's own default, else it isn't known
            const fallback = wholeNumber(schema?.default);
            if (fallback === null) {
                if (declared.includes(key)) unknownCount = true;
                continue;
            }
            found = true;
            if (isTimes) times = (times ?? 1) * fallback;
            else count = (count ?? 1) * fallback;
            unitKey ??= key;
            continue;
        }
        const value = wholeNumber(args[key]);
        if (value === null) {
            unknownCount = true;
            unreadable = true;
            continue;
        }
        found = true;
        if (isTimes) times = (times ?? 1) * value;
        else count = (count ?? 1) * value;
        unitKey ??= key;
    }

    const names = unitNames(unitKey, toolName, toolTitle);
    if (!found || unknownCount) return { known: false, unit: names.many, ...(unreadable ? { unreadable: true } : {}) };
    const total = (list ?? 1) * (count ?? 1) * (times ?? 1);
    return { known: true, count: total, unit: unitFor(total, names), names };
}

/* ---------------------------------------- so far in this request ---------------------------------------- */

/** What a request has made is forgotten after this long without a new thing. */
const IDLE_MS = 6 * 60 * 60_000;
const MAX_KEPT = 5000;

/**
 * How many things each request has made so far. A request is one person's message to one bot in one chat: the next message
 * starts a new count. Kept in this process, like the cards themselves.
 */
export class MakeCounts {
    private readonly counts = new Map<string, { made: number; at: number; epoch: number }>();

    constructor(private readonly now: () => number = Date.now) {}

    private kept(key: string): { made: number; at: number; epoch: number } | undefined {
        const kept = this.counts.get(key);
        if (!kept) return undefined;
        if (this.now() - kept.at > IDLE_MS) {
            // Forgotten after a long quiet: what comes next is a new request
            this.counts.delete(key);
            return undefined;
        }
        return kept;
    }

    soFar(key: string): number {
        return this.kept(key)?.made ?? 0;
    }

    /**
     * Which request this is: it changes each time the person asks for something new. Taken with a reservation, so what is
     * counted or taken back later (a tool can run for minutes) lands on the request it was for and never on a newer one.
     */
    epochOf(key: string): number {
        return this.kept(key)?.epoch ?? 0;
    }

    /**
     * Makes room for `count` more under the limit, all at once: calls started in the same moment can't each find room
     * for themselves. True when it fits (and is counted now, with the request it was counted for); false with how many were
     * made so far when it does not.
     */
    reserve(key: string, count: number, limit: number): { ok: true; epoch: number } | { ok: false; soFar: number } {
        const made = this.soFar(key);
        if (made + count > limit) return { ok: false, soFar: made };
        this.add(key, count);
        return { ok: true, epoch: this.epochOf(key) };
    }

    /** Counts things that were made (a tap on a card approved them). With `epoch`, only while that request is still the current one. */
    add(key: string, count: number, epoch?: number): void {
        if (epoch !== undefined && epoch !== this.epochOf(key)) return;
        const kept = this.kept(key);
        this.counts.delete(key);
        this.counts.set(key, { made: (kept?.made ?? 0) + count, at: this.now(), epoch: kept?.epoch ?? 0 });
        this.trim();
    }

    /** Keeps the map from growing for ever: the longest-quiet people are forgotten first. */
    private trim(): void {
        while (this.counts.size > MAX_KEPT) {
            const oldest = this.counts.keys().next().value;
            if (oldest === undefined) break;
            this.counts.delete(oldest);
        }
    }

    /** Takes back things that were counted but proved not to be made (the tool failed before making anything). Only from the request they were counted for. */
    release(key: string, count: number, epoch?: number): void {
        const kept = this.kept(key);
        if (!kept) return;
        if (epoch !== undefined && epoch !== kept.epoch) return;
        kept.made = Math.max(0, kept.made - count);
    }

    /** The person asked for something new: the count starts again, as a new request. */
    reset(key: string): void {
        const kept = this.counts.get(key);
        this.counts.delete(key);
        // The request is remembered (with nothing made) so what a slow tool reports later is told apart from this one
        this.counts.set(key, { made: 0, at: this.now(), epoch: (kept?.epoch ?? 0) + 1 });
        this.trim();
    }
}

/* ------------------------------------------- the card's words ------------------------------------------- */

export interface BatchWords {
    title: string;
    approve: string;
    decline: string;
    /** Lines that come before the tool's own details. */
    lines: Array<{ label?: string; text: string }>;
}

export type BatchKind =
    | { kind: 'over'; count: number; unit: string; limit: number }
    | { kind: 'part'; count: number; unit: string; limit: number; soFar: number; names: { one: string; many: string } }
    | { kind: 'unknown'; toolTitle: string; serverName?: string };

/** What the batch card says, in the words of mock 5. */
export function batchWords(batch: BatchKind): BatchWords {
    switch (batch.kind) {
        case 'over':
            return {
                title: `Make ${batch.count} ${batch.unit}`,
                approve: `Make all ${batch.count}`,
                decline: "Don't make",
                lines: [],
            };
        case 'part': {
            const total = batch.soFar + batch.count;
            return {
                title: `Make ${batch.count} more ${batch.unit}`,
                approve: `Make ${batch.count} more`,
                decline: `Stop at ${batch.soFar}`,
                lines: [
                    { label: 'So far', text: `${batch.soFar} ${unitFor(batch.soFar, batch.names)} made for this request` },
                    { label: 'With these', text: `${total} ${unitFor(total, batch.names)}, more than the ${batch.limit} this bot makes without asking` },
                ],
            };
        }
        case 'unknown':
            return {
                title: batch.toolTitle,
                approve: batch.toolTitle,
                decline: "Don't make",
                lines: [{ label: 'How many', text: `${batch.serverName || 'This tool'} doesn't say, so this bot asks every time` }],
            };
    }
}
