import { get } from "svelte/store";
import LL from "../../../i18n/i18n-svelte";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
import { JitsiCoWebsite } from "../../WebRtc/CoWebsite/JitsiCoWebsite";
import { BBBCoWebsite } from "../../WebRtc/CoWebsite/BBBCoWebsite";
import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
import { ArtifactCoWebsite } from "../../WebRtc/CoWebsite/ArtifactCoWebsite";
import { YourArtifactsCoWebsite } from "../../WebRtc/CoWebsite/YourArtifactsCoWebsite";
import { artifactBadge, YOUR_ARTIFACTS_ICON, YOUR_ARTIFACTS_ICON_BACKGROUND } from "../../Artifacts/artifactBadge";
import { yourArtifactsList } from "../../Artifacts/chatArtifactsList";
import { badgeOfKind, extensionOf, fileKindOf } from "../../FileViewer/fileKinds";
import { audioFileTitle } from "../../Chat/Components/Room/Message/audioFileTitle";
import jitsiIcon from "../images/jitsi.png";
import meetingIcon from "../images/meeting.svg";
import { coWebsiteIconBackground, coWebsiteIconUrl, coWebsiteSiteName } from "./coWebsiteRow";

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
    if (coWebsite instanceof ArtifactCoWebsite) {
        const { title, kind, makerName } = get(coWebsite.summary);
        return {
            name: title,
            line: makerName ? texts.chat.artifacts.by({ maker: makerName }) : "",
            badge: artifactBadge(kind, texts),
        };
    }
    if (coWebsite instanceof YourArtifactsCoWebsite) {
        return {
            name: texts.chat.artifacts.yours(),
            line: texts.chat.artifacts.yoursLine({ count: get(yourArtifactsList()).total }),
            iconSrc: YOUR_ARTIFACTS_ICON,
            iconBackground: YOUR_ARTIFACTS_ICON_BACKGROUND,
        };
    }
    if (coWebsite instanceof FileViewerCoWebsite) {
        const { source } = coWebsite;
        return {
            // A song is named as the chat player names it: a random file name says nothing.
            name: source.audio ? audioFileTitle(source.name) ?? texts.chat.audioFile.untitled() : source.name,
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
    return {
        name: coWebsiteSiteName(coWebsite),
        line,
        iconSrc: coWebsiteIconUrl(coWebsite),
        iconBackground: coWebsiteIconBackground(coWebsite),
    };
}
