import type { AppOffer } from "../Brick";
import type { ReconnectResult } from "./Reconnect";

/**
 * Connecting an App from a Brick's card in a chat (game #2001). One tap does it all: the App's own sign-in page opens, and
 * when it is done this Brick may use the App and the Brick carries on with what the person asked. Nothing in here reads a
 * store or talks to a server itself, so every step can be tested; the card gives it the pieces.
 *
 * - An App they connected already is only "let it use": no second sign-in.
 * - A new one: its connection is made and the sign-in window opens in the same tap (the window is opened first, so the
 *   browser does not block it), then this Brick is let use it. Only this Brick: the Apps page is where the others are chosen.
 * - An App that needs no sign-in has its connection made and its window closed at once, with no sign-in started.
 */
export type ChatConnectResult =
    /** Connected, this Brick may use it, and the Brick was told to carry on. */
    | "connected"
    /** The window was closed, or the sign-in did not finish. Nothing is left half done that the person must undo. */
    | "stopped"
    /** The window could not open, or the connection could not be made. */
    | "blocked"
    /** It is connected, but this Brick could not be let use it. */
    | "not_let"
    /** It is connected and this Brick may use it, but the Brick could not be told to carry on: only that is left to ask again. */
    | "not_resumed";

export interface ChatConnectSteps {
    /** Makes the person's connection to a listed App (or finds the one they have): its id. */
    connectListedApp: (key: string) => Promise<string>;
    /**
     * Opens the App's sign-in window now and ends when it ends. The App's connection is made once the window is open (so a blocked
     * window makes none), and `alreadyConnected` is asked with its id: an App that needs no sign-in closes the window at once.
     */
    signIn: (
        makeApp: () => Promise<string>,
        alreadyConnected: (appId: string) => Promise<boolean>
    ) => Promise<ReconnectResult>;
    /** Whether the person's connection works without a window (an App that needs no sign-in). */
    isConnected: (appId: string) => Promise<boolean>;
    /** Lets one of the person's Bricks use their App. */
    letBrickUse: (appId: string, brickId: string) => Promise<unknown>;
    /** Tells the Brick in this chat to carry on. */
    carryOn: (app: { app: string; name: string }) => Promise<void>;
    /** Reads the person's Apps again for the pages that show them. Never throws. */
    refresh: () => Promise<void>;
}

export async function connectFromCard(
    offer: AppOffer,
    brickId: string,
    steps: ChatConnectSteps
): Promise<ChatConnectResult> {
    let appId: string;
    if (offer.state === "connected" && offer.connectionId) {
        appId = offer.connectionId;
    } else {
        // The window opens straight from the tap; the connection is made behind it, and an App that needs no sign-in (Orbit does not
        // say which before it is made) closes that window at once instead of starting a sign-in
        let made: Promise<string> | undefined;
        const signedIn = await steps.signIn(
            () => {
                made = steps.connectListedApp(offer.app);
                made.catch(() => undefined);
                return made;
            },
            (id) => steps.isConnected(id)
        );
        // A window that could not open made no connection
        if (!made) return "blocked";
        let id: string | undefined;
        try {
            id = await made;
        } catch {
            return "blocked";
        }
        // The window could not start a sign-in: an App that needs none is connected already
        if (signedIn === "blocked" && !(await steps.isConnected(id).catch(() => false))) return "blocked";
        if (signedIn === "stopped") {
            await steps.refresh();
            return "stopped";
        }
        appId = id;
    }
    try {
        await steps.letBrickUse(appId, brickId);
    } catch (error) {
        console.warn("Could not let a Brick use an App", error);
        await steps.refresh();
        return "not_let";
    }
    await steps.refresh();
    try {
        await steps.carryOn({ app: offer.app, name: offer.name });
    } catch (error) {
        // The App is connected and the Brick may use it: only the carrying on is left, and the caller says so
        console.warn("Could not tell a Brick to carry on", error);
        return "not_resumed";
    }
    return "connected";
}
