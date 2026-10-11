import type { RequiredMetaTagsData } from "@workadventure/messages";

/**
 * The PWA manifest served dynamically by the pusher at
 * GET /static/images/favicons/manifest.json (see FrontController.displayManifestJson).
 *
 * Universe is a game, not a website: it runs fullscreen in landscape, and it must
 * not advertise the upstream WorkAdventure apps as related applications.
 */
export function buildManifest(metaTagsData: RequiredMetaTagsData, startUrl: string) {
    return {
        short_name: metaTagsData.title,
        name: metaTagsData.title,
        icons: metaTagsData.manifestIcons,
        start_url: startUrl,
        background_color: metaTagsData.themeColor,
        display_override: ["window-control-overlay", "minimal-ui"],
        display: "fullscreen" as const,
        orientation: "landscape" as const,
        scope: "/",
        lang: "en",
        theme_color: metaTagsData.themeColor,
        shortcuts: [
            {
                name: metaTagsData.title,
                short_name: metaTagsData.title,
                description: metaTagsData.description,
                url: "/",
                icons: metaTagsData.manifestIcons,
            },
        ],
        description: metaTagsData.description,
        screenshots: [],
        related_applications: [] as Array<{ platform: string; url: string }>,
    };
}
