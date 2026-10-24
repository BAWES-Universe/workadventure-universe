/**
 * The game's own address: the page every Open here frame sits in. Read straight from the environment (FRONT_URL, as
 * EnvironmentVariable reads it) so this check loads without the pusher's whole configuration. FRONT_URL can be a path
 * such as "/" (the front and the pusher share one host, as in docker-compose.prod.yaml), so it is read against
 * PUSHER_URL.
 */
export const GAME_ORIGIN = originOf(process.env.FRONT_URL ?? "", process.env.PUSHER_URL);

export function originOf(raw: string, base?: string): string | undefined {
    try {
        return new URL(raw, base || undefined).origin;
    } catch {
        return undefined;
    }
}

type HeaderValue = string | string[] | number | boolean | null | undefined;

/** The page's answer to "may I be shown inside another site?": its two headers, as the response carries them. */
export interface FrameHeaders {
    "x-frame-options"?: HeaderValue;
    "content-security-policy"?: HeaderValue;
}

function valuesOf(value: HeaderValue): string[] {
    if (value === undefined || value === null) return [];
    return (Array.isArray(value) ? value : [String(value)]).flatMap((entry) => entry.split(","));
}

/**
 * Whether a browser would show the page inside the game, from its two "don't frame me" headers. CSP frame-ancestors
 * wins when present (browsers then ignore X-Frame-Options); every policy that has it must allow the game. Without it,
 * X-Frame-Options DENY or SAMEORIGIN refuses (the game is never the page's own origin).
 */
export function isFrameable(headers: FrameHeaders, pageUrl: URL, embedderOrigin = GAME_ORIGIN): boolean {
    const ancestors = valuesOf(headers["content-security-policy"])
        .map((policy) => frameAncestorsOf(policy))
        .filter((sources): sources is string[] => sources !== undefined);
    if (ancestors.length > 0) {
        const embedder = embedderOrigin ? safeUrl(embedderOrigin) : undefined;
        if (!embedder) return false;
        return ancestors.every((sources) => sources.some((source) => sourceMatches(source, embedder, pageUrl)));
    }
    return !valuesOf(headers["x-frame-options"]).some((value) => {
        const option = value.trim().toLowerCase();
        return option === "deny" || option === "sameorigin";
    });
}

/** The sources of a policy's frame-ancestors directive; undefined when the policy doesn't have one. */
function frameAncestorsOf(policy: string): string[] | undefined {
    for (const directive of policy.split(";")) {
        const [name, ...sources] = directive.trim().split(/\s+/);
        if (name?.toLowerCase() === "frame-ancestors") {
            // 'none' counts only on its own: next to any other source it is ignored.
            return sources.filter((source) => source.toLowerCase() !== "'none'");
        }
    }
    return undefined;
}

function safeUrl(raw: string): URL | undefined {
    try {
        return new URL(raw);
    } catch {
        return undefined;
    }
}

const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

function portOf(url: URL): string {
    return url.port || DEFAULT_PORTS[url.protocol] || "";
}

/** CSP source matching for an ancestor (the game): *, 'self', a scheme, or a host with optional scheme, wildcard and port. */
function sourceMatches(rawSource: string, embedder: URL, pageUrl: URL): boolean {
    const source = rawSource.toLowerCase();
    if (source === "*") return embedder.protocol === "https:" || embedder.protocol === "http:";
    if (source === "'self'") return embedder.origin === pageUrl.origin;
    if (source.startsWith("'")) return false;
    // A scheme alone (https:); http: also lets an https page in.
    if (/^[a-z][a-z0-9+.-]*:$/.test(source)) return schemeMatches(source, embedder.protocol);

    const match = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([a-z0-9.-]+|\*)(?::(\d+|\*))?(\/.*)?$/);
    if (!match) return false;
    const [, scheme, wildcard, host, port, path] = match;
    if (
        scheme ? !schemeMatches(`${scheme}:`, embedder.protocol) : !schemeMatches(pageUrl.protocol, embedder.protocol)
    ) {
        return false;
    }
    const embedderHost = embedder.hostname.toLowerCase();
    if (host === "*") {
        if (wildcard) return false;
    } else if (wildcard) {
        if (!embedderHost.endsWith(`.${host}`)) return false;
    } else if (embedderHost !== host) {
        return false;
    }
    if (port !== "*") {
        // No port in the source: the ancestor must be on its scheme's default port.
        if ((port ?? DEFAULT_PORTS[embedder.protocol]) !== portOf(embedder)) return false;
    }
    // An ancestor is matched by its origin, whose path is "/".
    return !path || path === "/";
}

function schemeMatches(sourceScheme: string, embedderScheme: string): boolean {
    return sourceScheme === embedderScheme || (sourceScheme === "http:" && embedderScheme === "https:");
}
