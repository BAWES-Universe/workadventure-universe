/**
 * What the game keeps out of PostHog. PostHog is told who somebody is by Orbit's own id for them and nothing else:
 * never an email, a name, or anything somebody typed. Orbit finds the person by that id (Users > the person's page).
 */

const EMAIL = /[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+/g;
/** Properties PostHog adds itself that hold a page address. */
const ADDRESS_PROPERTIES = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"];
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
        return `${url.origin}${url.pathname}`;
    } catch {
        return address;
    }
}

/**
 * Whether an id can go to PostHog: Orbit's id for the person, which is a plain id. An email is not one (the game's own
 * `uuid` is the person's email once they sign in), so it is never sent.
 */
export function isSafeAnalyticsId(id: string | null | undefined): id is string {
    return typeof id === "string" && id.length > 0 && !id.includes("@");
}

function redact(properties: Record<string, unknown> | undefined): void {
    if (!properties) return;
    for (const key of FORBIDDEN_PROPERTIES) delete properties[key];
    for (const [key, value] of Object.entries(properties)) {
        if (typeof value === "string" && ADDRESS_PROPERTIES.includes(key)) {
            properties[key] = withoutQueryOrHash(value);
        } else if (typeof value === "string" && value.includes("@")) {
            properties[key] = value.replace(EMAIL, "[email]");
        }
    }
}

/**
 * Runs on every event just before it is sent (PostHog's `before_send`): the last place to stop something that should
 * not go, so a mistake in one of the events cannot send an email. It only removes; it never adds.
 */
export function keepPrivate<T extends { properties?: Record<string, unknown>; $set?: unknown; $set_once?: unknown }>(
    event: T | null
): T | null {
    if (!event) return event;
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
