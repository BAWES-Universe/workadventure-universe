import { slugify } from "@workadventure/shared-utils/src/Jitsi/slugify";
import type { SocketData } from "./Websocket/SocketData";

/**
 * Remembers the megaphone settings sent to a player, so the pusher can refuse a player going live in the megaphone
 * space without the megaphone right. The front joins the megaphone space under slugify(url).
 */
export function setMegaphoneSettings(
    socketData: Pick<SocketData, "megaphoneSpaceName" | "canUseMegaphone">,
    megaphoneSettings: { enabled: boolean; url?: string | undefined } | undefined
): void {
    socketData.megaphoneSpaceName = megaphoneSettings?.url ? slugify(megaphoneSettings.url) : null;
    socketData.canUseMegaphone = megaphoneSettings?.enabled ?? false;
}
