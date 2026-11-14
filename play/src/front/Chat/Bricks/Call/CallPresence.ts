import type { Readable, Unsubscriber } from "svelte/store";
import type { SpaceInterface } from "../../../Space/SpaceInterface";
import { onACallStore } from "./CallStore";

/**
 * Tells everyone in the world that this person is on a call with a Brick (game #2004, "On a call" for other people).
 *
 * It is a label next to their status, sent as its own flag on the world space and never as a status: Busy and Do not
 * disturb are not read or changed here. It goes out when the call starts and again when it ends, and once more after a
 * reconnect (the world space is new then, and a call that is still on says so again). Nobody is told when there is no
 * call, so a world with no calls sees no traffic from this.
 *
 * Returns what stops it (the scene ends, the connection is replaced).
 */
export function shareOnACall(
    space: Pick<SpaceInterface, "emitUpdateUser">,
    onACall: Readable<boolean> = onACallStore
): Unsubscriber {
    let told = false;
    return onACall.subscribe((now) => {
        if (now === told) return;
        told = now;
        space.emitUpdateUser({ onACall: now });
    });
}
