/**
 * Finds the links in a chat message, the way people actually type them:
 * full URLs (https://bawes.net/about) and bare site names (bawes.net,
 * www.example.com/pricing). Bare names get https:// so they can be fetched.
 *
 * Bare names only count with a known web suffix, so file names and code
 * (index.ts, node.js, readme.md) and e-mail addresses are never fetched.
 */

const FULL_URL = /https?:\/\/[^\s)<>"']+/gi;

// Common web suffixes.
const WEB_SUFFIXES = (
    'com net org dev app xyz info biz page site online store shop tech studio cloud blog news live world space club ' +
    'link design media agency digital network social games chat wiki pro edu gov'
).split(' ');

// Every country's two-letter web suffix (workadventu.re, bawes.kw, bbc.co.uk).
const COUNTRY_CODES = (
    'ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bv bw by bz ca cc ' +
    'cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gb ' +
    'gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke ' +
    'kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu ' +
    'mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw ' +
    'sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ' +
    'ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw'
).split(' ');

// Country codes that are also English words or times ("ok.so", "tell.me", "go.it", "at 10.am"), or file and
// code endings (readme.md, main.py, user.id), only count after www. (www.bawes.me).
const ONLY_AFTER_WWW = 'ad am as at be by do gd id in is it md me mk ml my no pl pm ps py rs so tf to us'.split(' ');

const BARE_SUFFIXES = [...WEB_SUFFIXES, ...COUNTRY_CODES.filter((code) => !ONLY_AFTER_WWW.includes(code))];
const ANY_SUFFIX = [...WEB_SUFFIXES, ...COUNTRY_CODES];
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.`;

const BARE_DOMAIN = new RegExp(
    // Not glued to an e-mail, a path or another word.
    String.raw`(?<![\w@/.:-])` +
        String.raw`((?:www\.(?:${LABEL})+(?:${ANY_SUFFIX.join('|')})|(?:${LABEL})+(?:${BARE_SUFFIXES.join('|')}))` +
        // Optional path, stopping before trailing punctuation or brackets.
        String.raw`(?:\/[^\s)<>"']*)?)` +
        String.raw`(?![\w@-])`,
    'gi'
);

const TRAILING_PUNCTUATION = /[.,!?;:]+$/;

/**
 * Turns a YouTube player link (/embed/ID) into its watch page, which carries the
 * title and description. The chat's old YouTube button sent embed links.
 */
export function canonicalizeLink(url: string): string {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
            const embed = parsed.pathname.match(/^\/embed\/([\w-]{6,})/);
            if (embed) return `https://www.youtube.com/watch?v=${embed[1]}`;
        }
        return url;
    } catch {
        return url;
    }
}

/**
 * Every link in the text, in order, deduplicated, capped at `max`.
 */
export function extractChatLinks(text: string, max: number): string[] {
    const found: { index: number; url: string }[] = [];
    const fullRanges: Array<[number, number]> = [];

    for (const match of text.matchAll(FULL_URL)) {
        const index = match.index ?? 0;
        fullRanges.push([index, index + match[0].length]);
        found.push({ index, url: match[0].replace(TRAILING_PUNCTUATION, '') });
    }

    for (const match of text.matchAll(BARE_DOMAIN)) {
        const index = match.index ?? 0;
        // Already part of a full URL.
        if (fullRanges.some(([start, end]) => index >= start && index < end)) continue;
        found.push({ index, url: `https://${match[1].replace(TRAILING_PUNCTUATION, '')}` });
    }

    const urls = found
        .sort((a, b) => a.index - b.index)
        .map(({ url }) => canonicalizeLink(url));
    return urls.filter((url, index) => urls.indexOf(url) === index).slice(0, max);
}

/**
 * A URL as a person or the model wrote it ("bawes.net", "www.x.com/a"), made fetchable.
 * Returns null when it isn't a web address.
 */
export function normalizeWebUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/\//, '')}`;
    try {
        const parsed = new URL(withScheme);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        if (!parsed.hostname.includes('.')) return null;
        return canonicalizeLink(parsed.toString());
    } catch {
        return null;
    }
}
