import type { SocketData } from "../models/Websocket/SocketData";
import { toServerSpaceName } from "./SpaceJoinPolicy";

type EvictionSocketData = Pick<
    SocketData,
    | "world"
    | "roomId"
    | "spaces"
    | "joinSpacesPromise"
    | "refusedAreaSpaces"
    | "listenOnlyAreaSpaces"
    | "invitedToSpeak"
>;

/**
 * The meeting rooms and speaker zones a player is in (or joining) that they may no longer be in, after the back sent
 * them new rules for the room's areas:
 * - an area that is now limited to roles they do not have;
 * - a stage they are streaming on that they may now only listen to (and where no speaker invited them).
 * Joining is checked when it is asked for; this covers the ones already joined, so a rule changed while people are
 * inside takes effect at once instead of at their next join. Names are the server's (world-prefixed).
 */
export function areaSpacesToLeave(
    socketData: EvictionSocketData,
    isStreamingIn: (serverSpaceName: string) => boolean
): string[] {
    const isIn = (serverName: string) =>
        socketData.spaces.has(serverName) || socketData.joinSpacesPromise.has(serverName);
    const toLeave = new Set<string>();

    for (const localName of socketData.refusedAreaSpaces ?? []) {
        const serverName = toServerSpaceName(socketData, localName);
        if (isIn(serverName)) {
            toLeave.add(serverName);
        }
    }
    for (const localName of socketData.listenOnlyAreaSpaces ?? []) {
        if (socketData.invitedToSpeak?.has(localName)) {
            continue;
        }
        const serverName = toServerSpaceName(socketData, localName);
        if (isIn(serverName) && isStreamingIn(serverName)) {
            toLeave.add(serverName);
        }
    }
    return [...toLeave];
}
