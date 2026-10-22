import { get } from "svelte/store";
import LL from "../../../i18n/i18n-svelte";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
import { JitsiCoWebsite } from "../../WebRtc/CoWebsite/JitsiCoWebsite";
import { BBBCoWebsite } from "../../WebRtc/CoWebsite/BBBCoWebsite";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import { badgeOfKind, extensionOf, fileKindOf } from "../../FileViewer/fileKinds";
import jitsiIcon from "../images/jitsi.png";
import meetingIcon from "../images/meeting.svg";
import { coWebsiteIconUrl, coWebsiteSiteName } from "./coWebsiteRow";

/** What the tabs and the "N open" list show about an open item. */
export interface CoWebsiteDescription {
    name: string;
    /** Where it came from: who sent a file, the address of a page. Empty when there is nothing to say (Hide URL). */
    line: string;
    /** A file's badge (PDF in red, other kinds in grey). */
    badge?: { label: string; color: string };
    /** A page's or meeting's picture. */
    iconSrc?: string;
    /** What shows through a transparent picture. */
    iconBackground?: string;
}

/** A file's badge, as the chat's file card draws it. */
export function fileBadgeFor(name: string): { label: string; color: string } {
    const fileKind = fileKindOf(name);
    if (fileKind) return badgeOfKind(fileKind, name);
    const extension = extensionOf(name);
    return { label: (extension || "FILE").slice(0, 4).toUpperCase(), color: "#5b6b82" };
}

/** `texts` is the current translations; pass `$LL` so the description follows a change of language. */
export function describeCoWebsite(coWebsite: CoWebsite, texts: TranslationFunctions = get(LL)): CoWebsiteDescription {
    const line = coWebsite.getHideUrl() ? "" : coWebsite.getUrl().hostname;
    if (coWebsite instanceof FileViewerCoWebsite) {
        const { source } = coWebsite;
        return {
            name: source.name,
            line: source.sentByMe
                ? texts.chat.fileViewer.fromYou()
                : source.senderName
                ? texts.chat.fileViewer.from({ name: source.senderName })
                : "",
            badge: fileBadgeFor(source.name),
        };
    }
    if (coWebsite instanceof JitsiCoWebsite) {
        return { name: texts.cowebsite.jitsi(), line, iconSrc: jitsiIcon, iconBackground: "#000" };
    }
    if (coWebsite instanceof BBBCoWebsite) {
        return { name: texts.cowebsite.bigBlueButton(), line, iconSrc: meetingIcon, iconBackground: "#000" };
    }
    return { name: coWebsiteSiteName(coWebsite), line, iconSrc: coWebsiteIconUrl(coWebsite) };
}
