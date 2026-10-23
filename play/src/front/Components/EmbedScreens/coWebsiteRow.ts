import { ICON_URL } from "../../Enum/EnvironmentVariable";
import youtubeSvg from "../images/applications/icon_youtube.svg";
import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { popupStore } from "../../Stores/PopupStore";
import PopUpCopyUrl from "../PopUp/PopUpCopyUrl.svelte";

const YOUTUBE = { name: "YouTube", icon: youtubeSvg };

/**
 * Hosts that serve a site under another address than the one people know it by, with the name and the icon the
 * site is known by. YouTube plays from its privacy-friendly embed address (youtube-nocookie.com), but it is YouTube.
 */
const KNOWN_SITES: Record<string, { name: string; icon: string }> = {
    "youtube.com": YOUTUBE,
    "m.youtube.com": YOUTUBE,
    "youtube-nocookie.com": YOUTUBE,
    "youtu.be": YOUTUBE,
};

/** The known site an open page belongs to, if its address is one of the hosts above. */
export function coWebsiteKnownSite(coWebsite: CoWebsite): { name: string; icon: string } | undefined {
    return KNOWN_SITES[coWebsite.getUrl().hostname.replace(/^www\./, "")];
}

/** The site's name as its tab always showed it: the host without "www" and the ending, with a capital. */
export function coWebsiteSiteName(coWebsite: CoWebsite): string {
    const known = coWebsiteKnownSite(coWebsite);
    if (known) return known.name;
    const name = coWebsite
        .getUrl()
        .toString()
        .replace(/.+\/\/|www.|\..+/g, "");
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What shows through the icon: our icons for known sites are round marks on nothing, not pictures that fill the square. */
export function coWebsiteIconBackground(coWebsite: CoWebsite): string | undefined {
    return coWebsiteKnownSite(coWebsite) ? "transparent" : undefined;
}

/** The site's own icon: the one we ship for a known site, else the one from the icon service. */
export function coWebsiteIconUrl(coWebsite: CoWebsite): string {
    const known = coWebsiteKnownSite(coWebsite);
    if (known) return known.icon;
    return `${ICON_URL}/icon?url=${encodeURIComponent(
        coWebsite.getUrl().toString()
    )}&size=64..96..256&fallback_icon_color=14304c`;
}

export function copyCoWebsiteLink(coWebsite: CoWebsite): void {
    navigator.clipboard.writeText(coWebsite.getUrl().toString()).catch((e) => console.error(e));
    analyticsClient.copyCowebsiteLink();
    popupStore.addPopup(PopUpCopyUrl, {}, "popupCopyUrl");
}

export function openCoWebsiteInBrowserTab(coWebsite: CoWebsite): void {
    window.open(coWebsite.getUrl().toString(), "_blank", "noopener");
    analyticsClient.openCowebsiteInNewTab();
}
