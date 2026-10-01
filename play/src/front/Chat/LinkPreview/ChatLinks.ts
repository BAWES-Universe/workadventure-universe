/**
 * Finds the links in a chat message, the way people actually type them: full URLs (https://bawes.net/about) and
 * bare site names (bawes.net, www.example.com/pricing). Bare names get https://.
 *
 * Bare names only count with a known web suffix, so file names and code (index.ts, node.js, readme.md) and e-mail
 * addresses are never taken for links. Same rules as the bots' link reading (bots/utils/chatLinks.ts).
 */

const FULL_URL = /https?:\/\/[^\s)<>"'`]+/gi;

// Common web suffixes, plus the Gulf country codes our users mostly use. Suffixes that are also English words
// (.me, .so, .to, .in, .us) are left out: "ok.so" isn't a website.
const BARE_SUFFIXES = [
    "com",
    "net",
    "org",
    "io",
    "ai",
    "dev",
    "app",
    "co",
    "gg",
    "tv",
    "xyz",
    "info",
    "biz",
    "sh",
    "fm",
    "ly",
    "page",
    "site",
    "online",
    "store",
    "shop",
    "tech",
    "studio",
    "cloud",
    "blog",
    "news",
    "edu",
    "gov",
    "uk",
    "ca",
    "de",
    "fr",
    "eu",
    "au",
    "kw",
    "sa",
    "ae",
    "qa",
    "bh",
    "om",
    "eg",
    "jo",
];

const BARE_DOMAIN = new RegExp(
    // Not glued to an e-mail, a path or another word.
    String.raw`(?<![\w@/.:-])` +
        String.raw`((?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:${BARE_SUFFIXES.join("|")})` +
        // Optional path, stopping before trailing punctuation or brackets.
        String.raw`(?:\/[^\s)<>"'\x60]*)?)` +
        String.raw`(?![\w@-])`,
    "gi"
);

const TRAILING_PUNCTUATION = /[.,!?;:*_~]+$/;

// Code is shown as code, not previewed.
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

/** Every link in the text, in order, without duplicates, at most `max`. */
export function extractChatLinks(text: string, max: number): string[] {
    const withoutCode = text.replace(CODE, (code) => " ".repeat(code.length));
    const found: { index: number; url: string }[] = [];
    const fullRanges: Array<[number, number]> = [];

    for (const match of withoutCode.matchAll(FULL_URL)) {
        const index = match.index ?? 0;
        fullRanges.push([index, index + match[0].length]);
        found.push({ index, url: match[0].replace(TRAILING_PUNCTUATION, "") });
    }

    for (const match of withoutCode.matchAll(BARE_DOMAIN)) {
        const index = match.index ?? 0;
        // Already part of a full URL.
        if (fullRanges.some(([start, end]) => index >= start && index < end)) continue;
        found.push({ index, url: `https://${match[1].replace(TRAILING_PUNCTUATION, "")}` });
    }

    const urls = found.sort((a, b) => a.index - b.index).map(({ url }) => url);
    return urls.filter((url, index) => urls.indexOf(url) === index).slice(0, max);
}
