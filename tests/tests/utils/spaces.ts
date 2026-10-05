/**
 * Same hash as libs/shared-utils/src/String/shortHash.ts, which the app uses to name a room's spaces.
 */
function shortHash(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

/**
 * The backend name of the space a LiveKit area property joins, for a room loaded from `mapUrl`.
 * The front names it `area__<shortHash(room URL)>-<room name>` (see libs/shared-utils/src/Space/areaSpaceName.ts),
 * without the URL's query, and the local admin puts every room in "localWorld".
 */
export function livekitAreaSpaceName(mapUrl: string, roomName: string): string {
    const url = new URL(mapUrl);
    return `localWorld.area__${shortHash(url.origin + url.pathname)}-${roomName}`;
}
