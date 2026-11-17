/**
 * "Ask the owner" on a Brick's card for an organization that has not allowed Universe's GitHub app (design 14 Nov, Part 3).
 * GitHub's own page for adding the app on that organization opens in a window: an owner installs it there, anyone else sends the
 * request that GitHub emails to the owners. The window is opened first, in the tap, so the browser does not block it, and the
 * page is put in it once Orbit has given the address. Nothing in here reads a store or talks to a server itself: the card gives it
 * the pieces, so every step can be tested.
 *
 *  - "asked": GitHub sent the request to the owners (the window went back to the game with nothing to finish).
 *  - "installed": the person is an owner and installed it: GitHub signed them in at the end, and that sign-in is finished here
 *    (the same way every sign-in is, by the person who started it), so the Brick may carry on.
 *  - "stopped": the window was closed, or GitHub did not take them back.
 *  - "blocked": the window could not open, or Orbit gave no page for this organization.
 */
export type OwnerOkResult = "asked" | "installed" | "stopped" | "blocked";

export interface OwnerOkSteps {
    /** GitHub's page for adding the app on this organization, the window going back to `returnTo` afterwards. */
    askUrl: (org: string, returnTo: string) => Promise<string>;
    /** Finishes the sign-in GitHub did at the end of an owner's install. */
    finishSignIn: (state: string, code: string) => Promise<unknown>;
}

export async function askOwnerInPopup(org: string, steps: OwnerOkSteps): Promise<OwnerOkResult> {
    const popup = window.open("", "oauth-popup", "width=600,height=700");
    if (!popup) return "blocked";
    let url: string;
    try {
        url = await steps.askUrl(org, window.location.href.split("?")[0].split("#")[0]);
    } catch (error) {
        console.warn("Could not get GitHub's page for this organization", error);
        closeQuietly(popup);
        return "blocked";
    }
    try {
        // Closed by hand while the request was on its way: nothing is left to ask
        if (popup.closed) return "stopped";
        popup.location.href = url;
    } catch (error) {
        console.warn("Could not open GitHub's page", error);
        return "blocked";
    }
    return await new Promise<OwnerOkResult>((resolve) => {
        let finishing = false;
        const done = (result: OwnerOkResult) => {
            window.removeEventListener("message", onMessage);
            window.removeEventListener("focus", onFocus);
            window.clearInterval(watch);
            resolve(result);
        };
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            const data = event.data as { type?: unknown; state?: unknown; code?: unknown } | null;
            if (data?.type === "oauth-success") done("asked");
            else if (data?.type === "oauth-failure") done("stopped");
            else if (data?.type === "oauth-github" && typeof data.state === "string" && typeof data.code === "string") {
                if (finishing) return;
                finishing = true;
                // An owner installed it: GitHub signed them in again. Whether that is finished or not, the app is on the organization now
                void steps
                    .finishSignIn(data.state, data.code)
                    .catch((error: unknown) => console.warn("Could not finish the GitHub sign-in", error))
                    .then(() => {
                        closeQuietly(popup);
                        done("installed");
                    });
            }
        };
        // The window closed by hand: noticed when this window gets focus back, or by the timer. Not while a sign-in is being finished.
        const onFocus = () => {
            if (finishing) return;
            try {
                if (popup.closed) done("stopped");
            } catch {
                // the window is on another site
            }
        };
        window.addEventListener("message", onMessage);
        window.addEventListener("focus", onFocus);
        const watch = window.setInterval(onFocus, 1000);
    });
}

function closeQuietly(popup: Window): void {
    try {
        popup.close();
    } catch {
        // already closed
    }
}
