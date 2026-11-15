import { get } from "svelte/store";
import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { loadMyApps, myAppsFailed, myAppsStore } from "./AppsStore";
import type { Connectable } from "./Connectable";
import { signInInPopup } from "./Reconnect";

/**
 * "Connect" on an app of "Connect another" (game #2001): the app's own sign-in page opens in a window, the way a bot's app signs
 * in, and one return connects it for the person. Nothing about the sign-in passes through the game: the page is the app's own,
 * and Orbit keeps what comes back.
 *
 * - "connected": the app is theirs now; `appId` is its connection, so the Apps page can open it to choose Bricks.
 * - "stopped": the window was closed or the sign-in failed. Nothing was connected.
 * - "blocked": the window could not open, or the sign-in did not start.
 * - "unchecked": the sign-in finished, but Orbit could not be asked whether it counted (twice). It may well be connected, so
 *   the page says to look again instead of saying nothing was connected.
 *
 * Call it straight from the tap: the window is opened first, before anything is awaited, so the browser does not block it.
 */
export type ConnectResult =
    | { status: "connected"; appId: string }
    | { status: "stopped" }
    | { status: "blocked" }
    | { status: "unchecked" };

/** Where the window is sent back to after a ready-made app's sign-in: the game's own page that tells this window and closes. */
const RETURN_PAGE = "/oauth-popup-callback.html?oauth=success";

function closeQuietly(popup: Window) {
    try {
        popup.close();
    } catch {
        // already closed
    }
}

/** How often a window that was closed by hand is looked for, since closing it sends nothing */
const CLOSED_CHECK_MS = 500;

/** Waits for the window to say it finished (`oauth-success` / `oauth-failure`), or to be closed by hand. */
function waitForPopup(popup: Window): Promise<"done" | "stopped"> {
    return new Promise((resolve) => {
        const isClosed = () => {
            try {
                return popup.closed;
            } catch {
                // the window is on another site while it signs in
                return false;
            }
        };
        const finish = (result: "done" | "stopped") => {
            window.removeEventListener("message", onMessage);
            clearInterval(timer);
            resolve(result);
        };
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const type = (event.data as { type?: unknown } | null)?.type;
            if (type === "oauth-success") finish("done");
            else if (type === "oauth-failure") finish("stopped");
        };
        // The window may already have been closed while the sign-in was being started, and closing sends nothing: so it is
        // looked at now and then, never only when this window gets focus back
        const timer = setInterval(() => {
            if (isClosed()) finish("stopped");
        }, CLOSED_CHECK_MS);
        window.addEventListener("message", onMessage);
        if (isClosed()) finish("stopped");
    });
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** An app of the list a super admin keeps: the connection is made while its window is already open. */
async function connectListed(app: Connectable): Promise<ConnectResult> {
    const made = botApiService.connectListedApp(app.key);
    // A window the browser would not open never waits for it: a failure then must not go unhandled
    made.catch(() => undefined);
    // Not awaited before the window opens: signInInPopup opens it first, then waits for the connection
    const result = await signInInPopup(made);
    if (result !== "done") return result === "blocked" ? { status: "blocked" } : { status: "stopped" };
    return { status: "connected", appId: await made };
}

/**
 * A ready-made app: Orbit starts the sign-in at the provider and answers the address of its page, unless the person is
 * already signed in there. The provider sends the window back to the game's own return page.
 */
async function connectReadyMade(app: Connectable): Promise<ConnectResult> {
    const popup = window.open("", "oauth-popup", "width=600,height=700");
    if (!popup) return { status: "blocked" };
    let appId: string;
    try {
        const answer = (await botApiService.connectReadyMadeApp(app.key, `${window.location.origin}${RETURN_PAGE}`)) as
            | { id?: unknown; redirectUrl?: unknown }
            | undefined;
        const id = text(answer?.id);
        if (!id) throw new Error("The app was not made");
        appId = id;
        const signInUrl = text(answer?.redirectUrl);
        // Already signed in at the app: nothing to open
        if (!signInUrl) {
            closeQuietly(popup);
            await loadMyApps(true);
            return { status: "connected", appId };
        }
        popup.location.href = signInUrl;
    } catch (error) {
        console.warn("Could not start the sign-in", error);
        closeQuietly(popup);
        return { status: "blocked" };
    }
    if ((await waitForPopup(popup)) === "stopped") return { status: "stopped" };
    await loadMyApps(true);
    // A read that failed leaves the list as it was, so it cannot say whether the sign-in counted: once more, then say so
    if (get(myAppsFailed)) await loadMyApps(true);
    if (get(myAppsFailed)) return { status: "unchecked" };
    // A ready-made app is connected only once its provider confirms the sign-in, which Orbit says when it lists the app: the
    // return alone is not enough
    return get(myAppsStore)?.some((one) => one.id === appId && one.connected)
        ? { status: "connected", appId }
        : { status: "stopped" };
}

export function connectApp(app: Connectable): Promise<ConnectResult> {
    return app.kind === "listed" ? connectListed(app) : connectReadyMade(app);
}
