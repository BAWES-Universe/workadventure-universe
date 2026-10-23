import { ICON_URL } from "../../Enum/EnvironmentVariable";
import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { showLinkCopiedToast } from "../../Stores/LinkCopiedToastStore";

/** The site's name as its tab always showed it: the host without "www" and the ending, with a capital. */
export function coWebsiteSiteName(coWebsite: CoWebsite): string {
    const name = coWebsite
        .getUrl()
        .toString()
        .replace(/.+\/\/|www.|\..+/g, "");
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The site's own icon, from the icon service. */
export function coWebsiteIconUrl(coWebsite: CoWebsite): string {
    return `${ICON_URL}/icon?url=${encodeURIComponent(
        coWebsite.getUrl().toString()
    )}&size=64..96..256&fallback_icon_color=14304c`;
}

export function copyCoWebsiteLink(coWebsite: CoWebsite): void {
    navigator.clipboard.writeText(coWebsite.getUrl().toString()).catch((e) => console.error(e));
    analyticsClient.copyCowebsiteLink();
    showLinkCopiedToast();
}

export function openCoWebsiteInBrowserTab(coWebsite: CoWebsite): void {
    window.open(coWebsite.getUrl().toString(), "_blank", "noopener");
    analyticsClient.openCowebsiteInNewTab();
}
