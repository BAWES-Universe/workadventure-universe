/**
 * Finds the links in a chat message, the way people actually type them: full URLs (https://bawes.net/about) and
 * bare site names (bawes.net, www.example.com/pricing). Bare names get https://.
 *
 * Bare names only count with a known web suffix, so file names and code (index.ts, node.js, readme.md) and e-mail
 * addresses are never taken for links. Same rules as the bots' link reading (bots/utils/chatLinks.ts).
 */

// The message box sends its text as HTML: a space typed at the end comes as &nbsp;, and < and > as &lt; and &gt;.
// Each ends a link, like the character it stands for.
const ESCAPED_END = "&(?:nbsp|lt|gt);";

const FULL_URL = new RegExp(String.raw`https?:\/\/(?:(?!${ESCAPED_END})[^\s)<>"'\x60])+`, "gi");

// Common web suffixes.
const WEB_SUFFIXES = (
    "com net org dev app xyz info biz page site online store shop tech studio cloud blog news live world space club " +
    "link design media agency digital network social games chat wiki pro edu gov"
).split(" ");

// Every country's two-letter web suffix (workadventu.re, bawes.kw, bbc.co.uk).
const COUNTRY_CODES = (
    "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bv bw by bz ca cc " +
    "cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gb " +
    "gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke " +
    "kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mg mh mk ml mm mn mo mp mq mr ms mt mu " +
    "mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw " +
    "sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz " +
    "ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw"
).split(" ");

// Country codes that are also English words or times ("ok.so", "tell.me", "go.it", "at 10.am"), or file and
// code endings (readme.md, main.py, user.id), only count after www. (www.bawes.me).
const ONLY_AFTER_WWW = "ad am as at be by do gd id in is it md me mk ml my no pl pm ps py rs so tf to us".split(" ");

const BARE_SUFFIXES = [...WEB_SUFFIXES, ...COUNTRY_CODES.filter((code) => !ONLY_AFTER_WWW.includes(code))];
const ANY_SUFFIX = [...WEB_SUFFIXES, ...COUNTRY_CODES];
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.`;

const BARE_DOMAIN = new RegExp(
    // Not glued to an e-mail, a path or another word.
    String.raw`(?<![\w@/.:-])` +
        String.raw`((?:www\.(?:${LABEL})+(?:${ANY_SUFFIX.join("|")})|(?:${LABEL})+(?:${BARE_SUFFIXES.join("|")}))` +
        // Optional path, stopping before trailing punctuation or brackets.
        String.raw`(?:\/(?:(?!${ESCAPED_END})[^\s)<>"'\x60])*)?)` +
        String.raw`(?![\w@-])`,
    "gi"
);

const TRAILING_PUNCTUATION = /[.,!?;:*_~]+$/;

// Code is shown as code, not previewed.
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

interface FoundLink {
    /** Where the link starts in the text, and its text as typed (without trailing punctuation). */
    index: number;
    raw: string;
    /** The link to open: bare names get https://. */
    url: string;
    /** Sent as <link>, the Discord way, to go without a preview. */
    noPreview: boolean;
}

/** Every link in the text, in order (code left out). */
function findLinks(text: string | undefined): FoundLink[] {
    // Images, files and deleted messages can come without a text body.
    if (typeof text !== "string") return [];
    const withoutCode = text.replace(CODE, (code) => " ".repeat(code.length));
    const found: FoundLink[] = [];
    const fullRanges: Array<[number, number]> = [];
    // <link>, typed or sent: the message box writes a typed one as &lt;link&gt;.
    const wrapped = (index: number, raw: string) => {
        const before = withoutCode.slice(0, index);
        const after = withoutCode.slice(index + raw.length);
        return (before.endsWith("<") || before.endsWith("&lt;")) && (after.startsWith(">") || after.startsWith("&gt;"));
    };

    for (const match of withoutCode.matchAll(FULL_URL)) {
        const index = match.index ?? 0;
        const raw = match[0].replace(TRAILING_PUNCTUATION, "");
        fullRanges.push([index, index + match[0].length]);
        found.push({ index, raw, url: raw, noPreview: wrapped(index, raw) });
    }

    for (const match of withoutCode.matchAll(BARE_DOMAIN)) {
        const index = match.index ?? 0;
        // Already part of a full URL.
        if (fullRanges.some(([start, end]) => index >= start && index < end)) continue;
        const raw = match[1].replace(TRAILING_PUNCTUATION, "");
        found.push({ index, raw, url: `https://${raw}`, noPreview: wrapped(index, raw) });
    }

    return found.sort((a, b) => a.index - b.index);
}

// The composer keeps & as &amp;: the same link either way.
function sameLink(a: string, b: string): boolean {
    return a.replace(/&amp;/g, "&") === b.replace(/&amp;/g, "&");
}

/** Every link in the text that can get a preview, in order, without duplicates, at most `max`. */
export function extractChatLinks(text: string, max: number): string[] {
    const urls = findLinks(text)
        .filter((link) => !link.noPreview)
        .map(({ url }) => url);
    return urls.filter((url, index) => urls.indexOf(url) === index).slice(0, max);
}

/**
 * The text to send when the sender closed a link's preview in the message box: the link goes as <link>, the way
 * Discord marks a link without a preview. It stays a link (Markdown shows <https://…> as one) and bots still read it.
 * A bare name gets https:// so Markdown sees a link rather than a tag.
 */
export function withoutPreview(text: string, urls: string[]): string {
    let result = text;
    // From the end, so earlier positions stay right.
    for (const link of findLinks(text).reverse()) {
        if (link.noPreview || !urls.some((url) => sameLink(url, link.url))) continue;
        const shown = link.raw === link.url ? link.raw : link.url;
        result = `${result.slice(0, link.index)}<${shown}>${result.slice(link.index + link.raw.length)}`;
    }
    return result;
}

/**
 * The text without its last link when that link ends the message (only spaces or end punctuation after it) and is
 * `url`: its card shows it instead, like the approved mock. Undefined when the link doesn't end the message.
 */
export function withoutTrailingLink(text: string, url: string): string | undefined {
    const links = findLinks(text);
    const last = links[links.length - 1];
    if (!last || last.noPreview || !sameLink(last.url, url)) return undefined;
    const after = text.slice(last.index + last.raw.length);
    if (!/^(?:[\s.,!?;:]|&nbsp;)*$/.test(after)) return undefined;
    return text.slice(0, last.index).trimEnd();
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
