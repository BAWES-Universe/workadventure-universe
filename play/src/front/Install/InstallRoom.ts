/**
 * The installed app starts at "/?installRoom=<path>" (see the manifest, play/src/pusher/services/WebManifest.ts):
 * the room it was installed from. It is used only when no last room is known yet, which is the first launch of an
 * app with empty storage (an iPhone keeps a home screen app's storage apart from Safari's).
 */
export const INSTALL_ROOM_PARAMETER = "installRoom";

/** The room path to open for that parameter, or undefined when it is missing or would leave this site. */
export function installRoomPath(value: string | null): string | undefined {
    if (value === null || !value.startsWith("/") || value.startsWith("//")) {
        return undefined;
    }
    return value;
}
