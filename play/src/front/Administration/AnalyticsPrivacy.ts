/**
 * What the game keeps out of PostHog. PostHog is told who somebody is by Orbit's own id for them and nothing else:
 * never an email, a name, or anything somebody typed. Orbit finds the person by that id (Users > the person's page).
 */

const EMAIL = /[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+/g;
/** Properties PostHog adds itself that hold a page address. */
const ADDRESS_PROPERTIES = [
    "$current_url",
    "$referrer",
    "$initial_current_url",
    "$initial_referrer",
    // Where a click on a link to another site went (autocapture): it can carry an invitation token
    "$external_click_url",
];
/** A value that is a web address by itself (not a sentence that holds one). */
const WEB_ADDRESS = /^https?:\/\/\S+$/i;
/** Attributes of a clicked element that hold an address; autocapture sends them in the element list and chain. */
const ELEMENT_ADDRESS_ATTRIBUTES = ["attr__href", "href", "attr__src", "src", "attr__action", "action"];
/** How deep a property may nest before the rest is dropped (a safeguard, no event is this deep). */
const MAX_DEPTH = 6;
/**
 * The session replay's recording (rrweb snapshots of the page). It nests far deeper than any other event, so it is cleaned
 * by its own walk (see cleanReplay), not by the depth-limited one the other properties get. The recorder masks text and inputs
 * as asterisks, but not the attributes of an element (a link's address, a data attribute): those are cleaned there.
 */
const REPLAY_PAYLOAD = "$snapshot_data";
/** The most values a recording is walked through; a larger one is not sent (it is dropped, never sent unchecked). */
const REPLAY_MAX_VALUES = 500_000;
/** Attributes of a page's element that hold an address (relative ones too): their query and hash are cut. */
const REPLAY_ADDRESS_KEYS =
    /^(?:attr__)?(?:href|src|action|poster|formaction|xlink:href|data-href|data-src|data-url)$/i;
/** An attribute whose name says it holds a secret: its value is never sent. */
const REPLAY_SECRET_KEYS = /token|invit|secret|passw|auth|credential|session|cookie|code|api[-_]?key|bearer/i;
/** Who an event is from. These are never edited: an edited id would merge different people into one. */
const IDENTITY_PROPERTIES = ["distinct_id", "$user_id", "$anon_distinct_id"];
/** Properties that must never leave the browser, whatever put them there. */
const FORBIDDEN_PROPERTIES = ["email", "$email", "uuid"];

/**
 * An address without its query and hash: those carry sign-in codes, invitation tokens and chat room ids. The room's
 * path stays, since which room people use is what the numbers are about. Anything that is not an address is
 * returned as it was.
 */
export function withoutQueryOrHash(address: string): string {
    try {
        const url = new URL(address);
        // An email in the path (/invite/sara@example.com, or /invite/sara%40example.com) is blanked too: the path stays, the email does not
        return `${url.origin}${emailFreePath(url.pathname)}`.replace(EMAIL, "[email]");
    } catch {
        return address;
    }
}

/** Whether a piece of a path holds an email, also when it is percent-encoded (once, or again on top of that). */
function segmentHoldsEmail(segment: string): boolean {
    let seen = segment;
    for (let round = 0; round < 4; round++) {
        if (new RegExp(EMAIL.source).test(seen)) return true;
        let decoded: string;
        try {
            decoded = decodeURIComponent(seen);
        } catch {
            // A malformed escape: what can be read of it is read (the rest of the piece stays as it is)
            decoded = seen.replace(/%([0-9a-f]{2})/gi, (_all, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        }
        if (decoded === seen) return false;
        seen = decoded;
    }
    // What the last round gave is read too; and a piece still encoded after the rounds is not read any further, and not trusted
    return new RegExp(EMAIL.source).test(seen) || /%[0-9a-f]{2}/i.test(seen);
}

/** A path with every piece that holds an email (also encoded) replaced by [email], and the rest as it was. */
function emailFreePath(path: string): string {
    return path
        .split("/")
        .map((segment) => (segmentHoldsEmail(segment) ? "[email]" : segment))
        .join("/");
}

/**
 * Whether an id can go to PostHog: Orbit's id for the person, which is a plain id. An email is not one (the game's own
 * `uuid` is the person's email once they sign in), so it is never sent.
 */
export function isSafeAnalyticsId(id: string | null | undefined): id is string {
    return typeof id === "string" && id.length > 0 && !id.includes("@");
}

/** An autocapture element chain, with the addresses its elements carry (href, src, action) taken out. */
function chainWithoutAddresses(chain: string): string {
    return chain.replace(/attr__(?:href|src|action)="(?:[^"\\]|\\.)*"/g, "");
}

function redact(properties: Record<string, unknown> | undefined, depth = 0): void {
    if (!properties) return;
    for (const key of FORBIDDEN_PROPERTIES) delete properties[key];
    for (const [key, value] of Object.entries(properties)) {
        if (key === REPLAY_PAYLOAD) {
            // Cleaned by its own walk; a recording too large to be walked is not sent
            if (!cleanReplay(value)) delete properties[key];
            continue;
        }
        if (IDENTITY_PROPERTIES.includes(key)) continue;
        // Any property that holds an address, not only the ones listed: PostHog adds more ($session_entry_url, ...)
        if (typeof value === "string" && (ADDRESS_PROPERTIES.includes(key) || WEB_ADDRESS.test(value))) {
            properties[key] = withoutQueryOrHash(value);
        } else if (typeof value === "string" && key === "$elements_chain") {
            properties[key] = chainWithoutAddresses(value).replace(EMAIL, "[email]");
        } else if (typeof value === "string" && value.includes("@")) {
            properties[key] = value.replace(EMAIL, "[email]");
        } else if (Array.isArray(value)) {
            if (depth >= MAX_DEPTH) {
                delete properties[key];
                continue;
            }
            redactList(value, depth + 1);
        } else if (value !== null && typeof value === "object") {
            // $set, $set_once and any other nested properties get the same rules as the top level
            if (depth >= MAX_DEPTH) {
                delete properties[key];
                continue;
            }
            redact(value as Record<string, unknown>, depth + 1);
        }
    }
}

/** A value of a replay recording, cleaned: an address without its query and hash, no email, no secret-named attribute's value. */
function cleanReplayValue(key: string, value: string): string {
    if (REPLAY_SECRET_KEYS.test(key) && !/^\*+$/.test(value)) return "[removed]";
    let cleaned = value;
    if (WEB_ADDRESS.test(cleaned)) cleaned = withoutQueryOrHash(cleaned);
    // A relative address (/invite/sara%40example.test?token=x): its query and hash are cut, and an email in its path goes, encoded or not
    else if (REPLAY_ADDRESS_KEYS.test(key)) cleaned = emailFreePath(cleaned.replace(/[?#].*$/s, ""));
    return cleaned.replace(EMAIL, "[email]");
}

/**
 * Cleans a session replay's recording in place, however deep it nests (a walk with no recursion). False when it holds more
 * than REPLAY_MAX_VALUES values: it could not be checked whole, so the caller does not send it.
 */
function cleanReplay(recording: unknown): boolean {
    const stack: unknown[] = [recording];
    let values = 0;
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === null || typeof current !== "object") continue;
        if (Array.isArray(current)) {
            for (let index = 0; index < current.length; index++) {
                if (++values > REPLAY_MAX_VALUES) return false;
                const item: unknown = current[index];
                if (typeof item === "string") current[index] = cleanReplayValue("", item);
                else stack.push(item);
            }
            continue;
        }
        const record = current as Record<string, unknown>;
        for (const key of Object.keys(record)) {
            if (++values > REPLAY_MAX_VALUES) return false;
            const item = record[key];
            if (typeof item === "string") record[key] = cleanReplayValue(key, item);
            else stack.push(item);
        }
    }
    return true;
}

function redactList(list: unknown[], depth: number): void {
    list.forEach((item, index) => {
        if (typeof item === "string") {
            if (WEB_ADDRESS.test(item)) list[index] = withoutQueryOrHash(item);
            else if (item.includes("@")) list[index] = item.replace(EMAIL, "[email]");
        } else if (Array.isArray(item)) {
            redactList(item, depth + 1);
        } else if (item !== null && typeof item === "object") {
            const element = item as Record<string, unknown>;
            // The elements of a click (autocapture): an element's address attributes are never sent
            for (const attribute of ELEMENT_ADDRESS_ATTRIBUTES) delete element[attribute];
            redact(element, depth + 1);
        }
    });
}

/**
 * Whether PostHog knows this browser by an email: earlier versions of the game identified people by their email, and
 * PostHog keeps that id in the browser. Such a browser starts again as an anonymous one (see AnalyticsClient).
 */
export function isEmailIdentity(distinctId: string | null | undefined): boolean {
    return typeof distinctId === "string" && distinctId.includes("@");
}

/**
 * Runs on every event just before it is sent (PostHog's `before_send`): the last place to stop something that should
 * not go, so a mistake in one of the events cannot send an email. It only removes; it never adds.
 */
export function keepPrivate<T extends { properties?: Record<string, unknown>; $set?: unknown; $set_once?: unknown }>(
    event: T | null
): T | null {
    if (!event) return event;
    // An event from an email id is not sent at all (not edited: the same edit for everyone would merge them).
    if (IDENTITY_PROPERTIES.some((key) => isEmailIdentity(event.properties?.[key] as string | undefined))) return null;
    redact(event.properties);
    redact(event.$set as Record<string, unknown> | undefined);
    redact(event.$set_once as Record<string, unknown> | undefined);
    return event;
}

/** A network request the session replay saw, with its address cleaned and no headers or bodies. */
export function maskedNetworkRequest<T extends { name?: string }>(request: T): T {
    return {
        ...request,
        name: request.name === undefined ? request.name : withoutQueryOrHash(request.name),
        requestHeaders: undefined,
        requestBody: undefined,
        responseHeaders: undefined,
        responseBody: undefined,
    };
}

/**
 * The address of the page the session replay saw (PostHog's `maskNetworkRequestFn` also cleans the page addresses in a
 * replay), without its query or hash: the hash carries chat room ids and the query sign-in codes.
 */
export function maskedReplayAddress<T extends { url?: string }>(request: T): T {
    return { ...request, url: request.url === undefined ? request.url : withoutQueryOrHash(request.url) };
}
