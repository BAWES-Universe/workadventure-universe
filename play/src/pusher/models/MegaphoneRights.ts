import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";
import type { SocketData } from "./Websocket/SocketData";

interface MegaphoneSettingsLike {
    enabled: boolean;
    url?: string | undefined;
    channels?: { url: string; canStream: boolean }[];
    refusedAreaSpaces?: string[];
    areaSpacesUnknown?: boolean;
    listenOnlyAreaSpaces?: string[];
}

/**
 * Remembers the broadcast channels the back sent to a player (on join and whenever the room's broadcast settings
 * change), so the pusher can refuse a player going live on a channel they have no right to. The front joins each
 * channel's space under slugify(url).
 */
export function setMegaphoneSettings(
    socketData: Pick<
        SocketData,
        "megaphoneChannels" | "refusedAreaSpaces" | "areaSpacePolicyUnknown" | "listenOnlyAreaSpaces"
    >,
    megaphoneSettings: MegaphoneSettingsLike | undefined
): void {
    const channels = new Map<string, boolean>();
    if (megaphoneSettings?.channels && megaphoneSettings.channels.length > 0) {
        for (const channel of megaphoneSettings.channels) {
            channels.set(slugify(channel.url), channel.canStream);
        }
    } else if (megaphoneSettings?.url) {
        // A back that only knows one channel
        channels.set(slugify(megaphoneSettings.url), megaphoneSettings.enabled);
    }
    socketData.megaphoneChannels = channels;
    // The front may join a space under its name or under the slugified name: refuse both
    socketData.refusedAreaSpaces = new Set(
        (megaphoneSettings?.refusedAreaSpaces ?? []).flatMap((name) => [name, slugify(name)])
    );
    socketData.areaSpacePolicyUnknown = megaphoneSettings?.areaSpacesUnknown === true;
    socketData.listenOnlyAreaSpaces = new Set(
        (megaphoneSettings?.listenOnlyAreaSpaces ?? []).flatMap((name) => [name, slugify(name)])
    );
}

/** A speaker invited this player to speak on the stage (the space name the front joins it with). */
export function recordSpeakInvitation(socketData: Pick<SocketData, "invitedToSpeak">, spaceLocalName: string): void {
    socketData.invitedToSpeak?.add(spaceLocalName);
}

/** The invitation is over: the player declined, or was sent back to the audience. */
export function forgetSpeakInvitation(socketData: Pick<SocketData, "invitedToSpeak">, spaceLocalName: string): void {
    socketData.invitedToSpeak?.delete(spaceLocalName);
}

// The spaces of broadcast channels, as WAMSettingsUtils.getMegaphoneChannels names them and the front slugifies them.
const MEGAPHONE_CHANNEL_SPACE = /-megaphone-(room|world|universe)$/;

/** Whether this space is a broadcast channel: one of the room's, or one named like another room's. */
export function isMegaphoneChannelSpace(
    spaceLocalName: string,
    socketData: Pick<SocketData, "megaphoneChannels">
): boolean {
    return socketData.megaphoneChannels?.has(spaceLocalName) === true || MEGAPHONE_CHANNEL_SPACE.test(spaceLocalName);
}

/**
 * Whether a player may go live (megaphoneState) in this space. A broadcast channel of the player's room needs the
 * right the back sent for it; another room's broadcast channel needs it too, so it is refused. Other live spaces, such
 * as speaker zones and map script spaces, are open to anyone in them. Nobody goes live before the room is joined.
 */
export function canGoLiveIn(
    spaceLocalName: string,
    socketData: Pick<SocketData, "megaphoneChannels" | "listenOnlyAreaSpaces" | "invitedToSpeak">
): boolean {
    const channels = socketData.megaphoneChannels;
    if (channels === undefined) {
        return false;
    }
    // A stage whose speaker zone is limited to roles this player does not have: they listen, unless a speaker invited them
    if (socketData.listenOnlyAreaSpaces?.has(spaceLocalName) && !socketData.invitedToSpeak?.has(spaceLocalName)) {
        return false;
    }
    const canStream = channels.get(spaceLocalName);
    if (canStream !== undefined) {
        return canStream;
    }
    return !isMegaphoneChannelSpace(spaceLocalName, socketData);
}
