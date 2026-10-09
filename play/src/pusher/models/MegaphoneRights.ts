import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";
import type { SocketData } from "./Websocket/SocketData";

interface MegaphoneSettingsLike {
    enabled: boolean;
    url?: string | undefined;
    channels?: { url: string; canStream: boolean }[];
}

/**
 * Remembers the broadcast channels the back sent to a player (on join and whenever the room's broadcast settings
 * change), so the pusher can refuse a player going live on a channel they have no right to. The front joins each
 * channel's space under slugify(url).
 */
export function setMegaphoneSettings(
    socketData: Pick<SocketData, "megaphoneChannels">,
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
export function canGoLiveIn(spaceLocalName: string, socketData: Pick<SocketData, "megaphoneChannels">): boolean {
    const channels = socketData.megaphoneChannels;
    if (channels === undefined) {
        return false;
    }
    const canStream = channels.get(spaceLocalName);
    if (canStream !== undefined) {
        return canStream;
    }
    return !isMegaphoneChannelSpace(spaceLocalName, socketData);
}
