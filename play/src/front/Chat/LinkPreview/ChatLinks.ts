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
    "live",
    "world",
    "space",
    "club",
    "link",
    "design",
    "media",
    "agency",
    "digital",
    "network",
    "social",
    "games",
    "chat",
    "wiki",
    "pro",
    "cc",
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

// Inside these, a site name stays as typed.
const NO_LINKS_INSIDE = "a, code, pre";

/**
 * Turns the bare site names in rendered message HTML (bawes.net, example.com/pricing) into links, as other chat
 * apps do. Full URLs are already links (Markdown autolinks them); links and code are left alone.
 */
export function linkifyBareDomains(html: string): string {
    // matchAll() starts from the regex's lastIndex: a quick test() must leave it at 0.
    const hasSiteName = BARE_DOMAIN.test(html);
    BARE_DOMAIN.lastIndex = 0;
    if (!hasSiteName) return html;

    const template = document.createElement("template");
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest(NO_LINKS_INSIDE)) textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
        const text = textNode.data;
        const fragment = document.createDocumentFragment();
        let last = 0;
        for (const match of text.matchAll(BARE_DOMAIN)) {
            const site = match[1].replace(TRAILING_PUNCTUATION, "");
            const index = match.index ?? 0;
            fragment.append(text.slice(last, index));
            const link = document.createElement("a");
            link.href = `https://${site}`;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.style.color = "white";
            link.textContent = site;
            fragment.append(link);
            last = index + site.length;
        }
        if (last === 0) continue;
        fragment.append(text.slice(last));
        textNode.replaceWith(fragment);
    }
    return template.innerHTML;
}
