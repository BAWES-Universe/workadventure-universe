/**
 * "Add your own app" (game #2001, mock Part 13): the sheet where a person pastes an app's link. Nothing in here talks to a
 * server or reads a store, so every rule can be unit tested.
 *
 * Orbit's `/api/mcp/oauth-discover` says how the app signs in. When it finds the sign-in page, one button opens it. When it
 * finds nothing, the sheet asks "How does it sign in?" and the person picks: the app's sign-in page (OAuth), a key or token,
 * or no sign-in at all. Orbit's `POST /api/me/apps` takes exactly what a bot's own app takes, with the same checks, and keeps
 * the way in locked; no screen reads it back.
 */

/** How the person says the app signs in, when the check found nothing */
export type SignIn = "oauth" | "key" | "none";

/** How a key is sent. Orbit and the bot server know these two; a header of the app's own name comes with the keys work. */
export type SentAs = "bearer" | "api-key";

export interface Discovery {
    /** The app told us how it signs in: its sign-in page and where to get a token */
    discovered: boolean;
    /** The name the app's address gives it ("Zapier"), to fill the Name field */
    name: string | undefined;
    /** Who runs the sign-in page ("Zapier"), for "Signs in with Zapier" */
    signsInWith: string | undefined;
    authorizeUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
    revocationUrl: string | undefined;
    /** "auto": Universe registered itself at the app, so one tap signs in. "manual": the person has to bring their own client. */
    registration: "auto" | "manual" | undefined;
}

export const NO_DISCOVERY: Discovery = {
    discovered: false,
    name: undefined,
    signsInWith: undefined,
    authorizeUrl: "",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
    scopes: "",
    revocationUrl: undefined,
    registration: undefined,
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** What Orbit's check answered, read with care: anything that is not what was promised counts as "didn't say". */
export function parseDiscovery(answer: unknown): Discovery {
    if (typeof answer !== "object" || answer === null) return NO_DISCOVERY;
    const body = answer as Record<string, unknown>;
    if (body.discovered !== true) return NO_DISCOVERY;
    const authorizeUrl = text(body.authorizeUrl);
    const tokenUrl = text(body.tokenUrl);
    // A sign-in page with no way to take the code back cannot be used
    if (!authorizeUrl || !tokenUrl) return NO_DISCOVERY;
    const scopes = Array.isArray(body.scopesSupported)
        ? body.scopesSupported.filter((scope): scope is string => typeof scope === "string").join(" ")
        : "";
    return {
        discovered: true,
        name: text(body.name) || undefined,
        signsInWith: text(body.signsInWith) || undefined,
        authorizeUrl,
        tokenUrl,
        clientId: text(body.clientId),
        clientSecret: text(body.clientSecret),
        scopes,
        revocationUrl: text(body.revocationUrl) || undefined,
        registration: body.registrationStatus === "auto" ? "auto" : "manual",
    };
}

/** The tap on "Sign in with Zapier" works on its own only when Universe could register itself at the app */
export function signsInByItself(discovery: Discovery): boolean {
    return discovery.discovered && discovery.registration === "auto" && discovery.clientId !== "";
}

/** A link worth checking: a web address, with something after the slashes. Orbit is the one that refuses a private address. */
export function looksLikeLink(link: string): boolean {
    const trimmed = link.trim();
    if (!/^https?:\/\/[^\s/]+\S*$/i.test(trimmed)) return false;
    try {
        return new URL(trimmed).hostname.includes(".");
    } catch {
        return false;
    }
}

/** Orbit refuses these as extra headers, because the way in is kept apart and locked */
const RESERVED_HEADERS = ["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"];

export interface HeaderRow {
    /** Only to tell the rows apart on the sheet */
    id?: number;
    key: string;
    value: string;
}

/** The first extra header Orbit would refuse, or undefined when all are fine */
export function reservedHeader(rows: HeaderRow[]): string | undefined {
    return rows.map((row) => row.key.trim()).find((key) => RESERVED_HEADERS.includes(key.toLowerCase()));
}

/** Extra headers as Orbit takes them: a row with no name is left out */
export function headersBody(rows: HeaderRow[]): Record<string, string> | undefined {
    const filled = rows.filter((row) => row.key.trim());
    return filled.length > 0 ? Object.fromEntries(filled.map((row) => [row.key.trim(), row.value])) : undefined;
}

export interface OAuthFields {
    authorizeUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
    revocationUrl?: string;
}

/** Whether the person filled in what Universe needs to open the app's sign-in page */
export function oauthFieldsDone(fields: OAuthFields, registration: Discovery["registration"]): boolean {
    if (!fields.authorizeUrl.trim() || !fields.tokenUrl.trim()) return false;
    // When Universe registered itself the client is its own and the person has nothing to bring
    if (registration === "auto") return true;
    return fields.clientId.trim() !== "" && fields.clientSecret.trim() !== "";
}

/** The sign-in settings as Orbit keeps them, in the shape a bot's own app uses today */
export function oauthConfig(fields: OAuthFields): string {
    return JSON.stringify({
        authorizeUrl: fields.authorizeUrl.trim(),
        tokenUrl: fields.tokenUrl.trim(),
        clientId: fields.clientId.trim() || null,
        clientSecret: fields.clientSecret.trim() || null,
        scopes: fields.scopes.trim(),
        ...(fields.revocationUrl ? { revocationUrl: fields.revocationUrl } : {}),
    });
}

export interface NewApp {
    name: string;
    serverUrl: string;
    authType: "none" | "bearer" | "api-key" | "oauth";
    authConfig?: string;
    headers?: Record<string, string>;
}

/** The body of `POST /api/me/apps` for each way in. The key goes straight to Orbit and nowhere else. */
export function newAppBody(input: {
    name: string;
    link: string;
    signIn: SignIn;
    sentAs: SentAs;
    key: string;
    oauth: OAuthFields;
    headers: HeaderRow[];
}): NewApp {
    const body: NewApp = { name: input.name.trim(), serverUrl: input.link.trim(), authType: "none" };
    if (input.signIn === "oauth") {
        body.authType = "oauth";
        body.authConfig = oauthConfig(input.oauth);
    } else if (input.signIn === "key") {
        body.authType = input.sentAs;
        body.authConfig = input.key.trim();
    }
    const headers = headersBody(input.headers);
    if (headers) body.headers = headers;
    return body;
}

/**
 * What the app can do, as Orbit lists it once the app is connected: a list of names. Anything else, or a list with nothing
 * in it, is `undefined`, and the sheet then says "Connected" without a count.
 */
export function parseThings(answer: unknown): string[] | undefined {
    if (typeof answer !== "object" || answer === null) return undefined;
    const things = (answer as { things?: unknown }).things;
    if (!Array.isArray(things)) return undefined;
    const names = things
        .map((thing) => (typeof thing === "string" ? thing : text((thing as { name?: unknown } | null)?.name)))
        .map((name) => name.trim())
        .filter(Boolean);
    return names.length > 0 ? names : undefined;
}

/** The id Orbit gave a new app, or undefined when the answer is not what was promised */
export function parseNewAppId(answer: unknown): string | undefined {
    const id = (answer as { id?: unknown } | null | undefined)?.id;
    return typeof id === "string" && id ? id : undefined;
}
