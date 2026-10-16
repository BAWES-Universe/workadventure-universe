import type { RequiredMetaTagsData } from "@workadventure/messages";

/** The query parameter of the app's start address that carries the room it was installed from. */
export const INSTALL_ROOM_PARAMETER = "installRoom";

/**
 * The room a page shows, as a path ("/@/universe/world/room"), or undefined for the start page without one.
 * Only the path is kept: a query or a hash can hold a login token and must never end up in a manifest.
 * The installed app's own start page ("/?installRoom=<path>") hands its room on, so the manifest the browser
 * re-reads for it stays the same.
 */
export function roomPathOfPage(pageUrl: string): string | undefined {
    let url: URL;
    try {
        url = new URL(pageUrl);
    } catch {
        return undefined;
    }
    const path = url.pathname === "/" ? url.searchParams.get(INSTALL_ROOM_PARAMETER) : url.pathname;
    if (path === null || path === "/" || !path.startsWith("/") || path.startsWith("//")) {
        return undefined;
    }
    return path;
}

/**
 * Whether the page is the installed app's own start page ("/?installRoom=<path>", see the manifest below).
 * Orbit answers a bare "/" with a redirect to the start room, which would send the app there before the game can
 * open the last room this device was in; the start page of an installed app is served as it is instead.
 */
export function isInstalledAppStart(pageUrl: string): boolean {
    try {
        return new URL(pageUrl).pathname === "/" && roomPathOfPage(pageUrl) !== undefined;
    } catch {
        return false;
    }
}

/**
 * The web app manifest of Universe.
 *
 * One app for every room: the id is fixed and the name is "Universe", never the room's title. Opening it starts at
 * "/", which opens the last room; the room it was installed from rides along in the start address so the very first
 * launch, with empty storage (an iPhone keeps its home screen app's storage apart from Safari's), lands there too.
 */
/**
 * The address the page links its manifest from, absolute: the browser matches it against the installed app. It
 * carries the room's origin and path only, never the page's query or hash (they can hold a login token), and is
 * encoded the same way the page encodes it when the room changes (see pointManifestAtRoom).
 */
export function manifestUrlOfPage(pageUrl: string): string | undefined {
    try {
        const origin = new URL(pageUrl).origin;
        const manifestUrl = new URL("/static/images/favicons/manifest.json", origin);
        manifestUrl.searchParams.set("url", origin + (roomPathOfPage(pageUrl) ?? "/"));
        return manifestUrl.href;
    } catch {
        return undefined;
    }
}

export function buildWebManifest(metaTagsData: RequiredMetaTagsData, pageUrl: string) {
    const roomPath = roomPathOfPage(pageUrl);
    const manifestUrl = manifestUrlOfPage(pageUrl);
    return {
        id: "/",
        name: metaTagsData.appName,
        short_name: metaTagsData.shortAppName,
        icons: metaTagsData.manifestIcons,
        start_url: roomPath ? `/?${INSTALL_ROOM_PARAMETER}=${encodeURIComponent(roomPath)}` : "/",
        background_color: metaTagsData.themeColor,
        // Standalone: a window of its own, with no browser bar. Any orientation: a phone turns sideways too.
        display: "standalone",
        // On a computer, Chrome and Edge let the app draw its own title bar in place of the grey one (the player
        // switches it on once with the small arrow). Everything that does not know it falls back to "standalone".
        display_override: ["window-controls-overlay"],
        scope: "/",
        lang: "en",
        theme_color: metaTagsData.themeColor,
        // Opening a Universe link while the app is open brings that window forward and goes to the link.
        launch_handler: { client_mode: ["navigate-existing", "auto"] },
        shortcuts: [
            {
                name: metaTagsData.appName,
                short_name: metaTagsData.shortAppName,
                description: metaTagsData.description,
                url: "/",
                icons: metaTagsData.manifestIcons,
            },
        ],
        description: metaTagsData.description,
        // Our own manifest only: this is how Chrome and Edge can tell the page that the app is already installed
        // (navigator.getInstalledRelatedApps), so the install card and menu row can step aside.
        // Chrome and Edge 140 and later on computers need the app's id here: the manifest id, resolved against the origin.
        related_applications: manifestUrl
            ? [{ platform: "webapp", url: manifestUrl, id: new URL("/", manifestUrl).href }]
            : [],
        screenshots: [],
    };
}
