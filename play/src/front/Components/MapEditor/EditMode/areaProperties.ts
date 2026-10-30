import type { ComponentType } from "svelte";
import { get } from "svelte/store";
import type { AreaDataProperties, AreaDataPropertiesKeys, AreaDataProperty } from "@workadventure/map-editor";
import { PersonalAreaAccessClaimMode, SpeakerMegaphonePropertyData } from "@workadventure/map-editor";
import type { ApplicationDefinitionInterface } from "@workadventure/messages";
import { v4 as uuid } from "uuid";
import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import { mapEditorSelectedAreaPreviewStore } from "../../../Stores/MapEditorStore";
import { ADMIN_URL, FEATURE_FLAG_BROADCAST_AREAS, MATRIX_PUBLIC_URI } from "../../../Enum/EnvironmentVariable";
import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
import { ON_ACTION_TRIGGER_ENTER } from "../../../WebRtc/LayoutManager";
import { gameManager } from "../../../Phaser/Game/GameManager";
import type { ExtensionModuleAreaProperty } from "../../../ExternalModule/ExtensionModule";
import {
    IconDesk,
    IconDoorIn,
    IconDoorOut,
    IconEar,
    IconFile,
    IconFileMusic,
    IconFocus,
    IconLink,
    IconLock,
    IconLockCog,
    IconMessage,
    IconMicrophone,
    IconMicrophoneOff,
    IconTooltip,
    IconUsers,
    IconUsersGroup,
    IconZoomInArea,
} from "@wa-icons";

/**
 * The settings an area can have, as rows: what they are called, one line about them, their icon, and when they
 * may be added. The engine side (the property data itself) is unchanged; this only decides what the rows show.
 */
export interface AreaSettingRow {
    key: AreaDataPropertiesKeys;
    subtype?: string;
    title: string;
    text: string;
    icon: ComponentType;
    testId: string;
    /** False hides the row (a feature that is off, or a setting that cannot go with one already on). */
    available: boolean;
    /** True shows the row greyed out and not tappable: it cannot go with a setting already on (the old editor's
     *  disabled buttons, e.g. Stage next to a meeting room). */
    blocked?: boolean;
    /** True opens the setting's own page right after adding it. */
    opensPage: boolean;
}

export interface AreaSettingFlags {
    [type: string]: boolean;
}

/** A new "Play a sound" starts at 60 % (#1626 mock); map makers change it with the Volume slider. */
export const NEW_SOUND_VOLUME = 0.6;

export function flagsOf(properties: AreaDataProperties): AreaSettingFlags {
    const flags: AreaSettingFlags = {};
    for (const property of properties) flags[property.type] = true;
    return flags;
}

/** The rows of "Add to this area", in the order of the mock: calls first, then access, then what happens inside. */
export function areaSettingRows(LL: TranslationFunctions, flags: AreaSettingFlags): AreaSettingRow[] {
    const t = LL.mapEditor.edit.properties;
    const hasAccess = !!flags.personalAreaPropertyData || !!flags.restrictedRightsPropertyData;
    return [
        {
            key: "livekitRoomProperty",
            title: t.livekitRoomProperty.title(),
            text: t.livekitRoomProperty.text(),
            icon: IconUsersGroup,
            testId: "livekitRoomProperty",
            available: !flags.livekitRoomProperty && !flags.speakerMegaphone && !flags.listenerMegaphone,
            blocked: !flags.livekitRoomProperty && (!!flags.speakerMegaphone || !!flags.listenerMegaphone),
            opensPage: true,
        },
        {
            key: "silent",
            title: t.silent.title(),
            text: t.silent.text(),
            icon: IconMicrophoneOff,
            testId: "addSilentProperty",
            available: !flags.silent,
            opensPage: false,
        },
        {
            key: "speakerMegaphone",
            title: t.speakerMegaphone.title(),
            text: t.speakerMegaphone.text(),
            icon: IconMicrophone,
            testId: "speakerMegaphone",
            available:
                FEATURE_FLAG_BROADCAST_AREAS &&
                !flags.speakerMegaphone &&
                !flags.listenerMegaphone &&
                !flags.livekitRoomProperty,
            blocked:
                FEATURE_FLAG_BROADCAST_AREAS &&
                !flags.speakerMegaphone &&
                (!!flags.listenerMegaphone || !!flags.livekitRoomProperty),
            opensPage: true,
        },
        {
            key: "listenerMegaphone",
            title: t.listenerMegaphone.title(),
            text: t.listenerMegaphone.text(),
            icon: IconEar,
            testId: "listenerMegaphone",
            available:
                FEATURE_FLAG_BROADCAST_AREAS &&
                !flags.listenerMegaphone &&
                !flags.speakerMegaphone &&
                !flags.livekitRoomProperty,
            blocked:
                FEATURE_FLAG_BROADCAST_AREAS &&
                !flags.listenerMegaphone &&
                (!!flags.speakerMegaphone || !!flags.livekitRoomProperty),
            opensPage: true,
        },
        {
            key: "restrictedRightsPropertyData",
            title: t.restrictedRightsPropertyData.title(),
            text: t.restrictedRightsPropertyData.text(),
            icon: IconLockCog,
            testId: "restrictedRightsPropertyData",
            available: !hasAccess,
            opensPage: true,
        },
        {
            key: "maxUsersInAreaPropertyData",
            title: t.maxUsersInAreaPropertyData.title(),
            text: t.maxUsersInAreaPropertyData.text(),
            icon: IconUsers,
            testId: "maxUsersInAreaPropertyData",
            available: !flags.maxUsersInAreaPropertyData,
            opensPage: true,
        },
        {
            key: "lockableAreaPropertyData",
            title: t.lockableAreaPropertyData.title(),
            text: t.lockableAreaPropertyData.text(),
            icon: IconLock,
            testId: "lockableAreaPropertyData",
            available: !flags.lockableAreaPropertyData,
            opensPage: true,
        },
        {
            key: "personalAreaPropertyData",
            title: t.personalAreaPropertyData.title(),
            text: t.personalAreaPropertyData.text(),
            icon: IconDesk,
            testId: "personalAreaPropertyData",
            available: !hasAccess && !!ADMIN_URL,
            opensPage: true,
        },
        {
            key: "openWebsite",
            title: t.openWebsite.title(),
            text: t.openWebsite.text(),
            icon: IconLink,
            testId: "openWebsite",
            available: true,
            opensPage: true,
        },
        {
            key: "openFile",
            title: t.openFile.title(),
            text: t.openFile.text(),
            icon: IconFile,
            testId: "openFile",
            available: true,
            opensPage: true,
        },
        {
            key: "playAudio",
            title: t.playAudio.title(),
            text: t.playAudio.text(),
            icon: IconFileMusic,
            testId: "playAudio",
            available: !flags.playAudio,
            opensPage: true,
        },
        {
            key: "exit",
            title: t.exit.title(),
            text: t.exit.text(),
            icon: IconDoorOut,
            testId: "exitAreaProperty",
            available: !flags.exit,
            opensPage: true,
        },
        {
            key: "start",
            title: t.start.title(),
            text: t.start.text(),
            icon: IconDoorIn,
            testId: "startAreaProperty",
            available: !flags.start,
            opensPage: false,
        },
        {
            key: "focusable",
            title: t.focusable.title(),
            text: t.focusable.text(),
            icon: IconZoomInArea,
            testId: "focusable",
            available: !flags.focusable,
            opensPage: true,
        },
        {
            key: "highlight",
            title: t.highlight.title(),
            text: t.highlight.text(),
            icon: IconFocus,
            testId: "highlight",
            available: !flags.highlight,
            opensPage: true,
        },
        {
            key: "tooltipPropertyData",
            title: t.tooltipPropertyData.title(),
            text: t.tooltipPropertyData.text(),
            icon: IconTooltip,
            testId: "addTooltipProperty",
            available: !flags.tooltipPropertyData,
            opensPage: true,
        },
        {
            key: "matrixRoomPropertyData",
            title: t.matrixRoomPropertyData.title(),
            text: t.matrixRoomPropertyData.text(),
            icon: IconMessage,
            testId: "matrixRoomPropertyData",
            available: !flags.matrixRoomPropertyData && !!MATRIX_PUBLIC_URI,
            opensPage: true,
        },
        {
            key: "jitsiRoomProperty",
            title: t.jitsiRoomProperty.title(),
            text: t.jitsiRoomProperty.text(),
            icon: IconUsersGroup,
            testId: "jitsiRoomProperty",
            // Jitsi is no longer offered: the meeting room runs on our own calls. The row stays so an area that already
            // has one still shows its title, its page and its Remove button.
            available: false,
            opensPage: true,
        },
    ];
}

/** The title and line of a setting that is on, from its data. */
export function describeAreaProperty(
    LL: TranslationFunctions,
    property: AreaDataProperty,
    extensionRows: { [subtype: string]: ExtensionModuleAreaProperty }[] = []
): { title: string; text: string; icon: ComponentType } {
    const t = LL.mapEditor.edit.properties;
    const rows = areaSettingRows(LL, {});
    if (property.type === "openWebsite" && property.application && property.application !== "website") {
        return { title: property.label ?? property.application, text: t.app.text(), icon: IconLink };
    }
    const row = rows.find((r) => r.key === property.type);
    if (row) return { title: row.title, text: row.text, icon: row.icon };
    if (property.type === "extensionModule") {
        // A module's own name for its setting (the portal: "Teleport"), as the old editor showed its own button.
        const label = extensionRows.find((row) => row[property.subtype]?.label)?.[property.subtype]?.label;
        if (label) return label;
        return { title: property.subtype, text: t.extensionModule.text(), icon: IconLink };
    }
    return { title: property.type, text: "", icon: IconLink };
}

/** The last part of a path or URL, without its query, hash and extension, as people read it ("Lobby" for ".../Lobby.wam"). */
function lastSegmentName(path: string): string {
    const clean = path.split("#")[0].split("?")[0].replace(/\/+$/, "");
    const segment = clean.slice(clean.lastIndexOf("/") + 1);
    let decoded = segment;
    try {
        decoded = decodeURIComponent(segment);
    } catch {
        // A malformed escape: the raw text is still the best name there is.
    }
    return decoded.replace(/\.(wam|tmj|json)$/i, "").trim();
}

/** The host of a link without "www.", or undefined when it is not a link. */
function hostOf(link: string): string | undefined {
    try {
        const host = new URL(link).hostname.replace(/^www\./i, "");
        return host === "" ? undefined : host;
    } catch {
        return undefined;
    }
}

const SUMMARY_TOOLTIP_LENGTH = 40;

/**
 * The line under a setting's title: what is actually set on it ("To Lobby · at Front door", "Only: admin, staff").
 * Falls back to the setting's fixed line (`fallbackText`) when nothing useful is set. `stages` maps a Stage's area
 * id to its name (the listener names its Stage by area id).
 */
export function summarizeAreaProperty(
    LL: TranslationFunctions,
    property: AreaDataProperty,
    fallbackText: string,
    stages?: Map<string, string>
): string {
    const t = LL.mapEditor.edit.areas.summary;
    switch (property.type) {
        case "exit": {
            const room = lastSegmentName(property.url ?? "");
            if (room === "") return fallbackText;
            const area = property.areaName?.trim();
            return area ? t.toRoomAt({ room, area }) : t.toRoom({ room });
        }
        case "speakerMegaphone": {
            const name = property.name?.trim();
            if (!name) return fallbackText;
            return property.chatEnabled ? t.chatOn({ name }) : name;
        }
        case "listenerMegaphone": {
            const stage = (stages ?? speakerZones()).get(property.speakerZoneName)?.trim();
            return stage ? t.hears({ stage }) : fallbackText;
        }
        case "restrictedRightsPropertyData": {
            const tags = [...new Set([...(property.readTags ?? []), ...(property.writeTags ?? [])])].filter(
                (tag) => tag.trim() !== ""
            );
            return tags.length > 0 ? t.onlyTags({ tags: tags.join(", ") }) : fallbackText;
        }
        case "maxUsersInAreaPropertyData": {
            return property.maxUsers && property.maxUsers >= 1 ? t.upTo({ count: property.maxUsers }) : fallbackText;
        }
        case "lockableAreaPropertyData": {
            const roles = LL.mapEditor.properties.rolePicker;
            const names: Record<string, string> = {
                admin: roles.admin(),
                editor: roles.editor(),
                member: roles.member(),
            };
            const tags = (property.allowedTags ?? []).filter((tag) => tag.trim() !== "");
            return tags.length > 0
                ? t.lockOnly({ roles: tags.map((tag) => names[tag] ?? tag).join(", ") })
                : t.lockAnyone();
        }
        case "openWebsite": {
            return (property.link ? hostOf(property.link) : undefined) ?? fallbackText;
        }
        case "openFile": {
            return property.name?.trim() || fallbackText;
        }
        case "playAudio": {
            const file = property.audioName?.trim() || lastSegmentName(property.audioLink ?? "");
            if (file === "") return fallbackText;
            const volume = property.volume ?? 1;
            return volume !== 1 ? `${file} · ${Math.round(volume * 100)}%` : file;
        }
        case "tooltipPropertyData": {
            const content = (property.content ?? "").replace(/\s+/g, " ").trim();
            if (content === "") return fallbackText;
            const shown =
                content.length > SUMMARY_TOOLTIP_LENGTH
                    ? `${content.slice(0, SUMMARY_TOOLTIP_LENGTH).trimEnd()}…`
                    : content;
            return `“${shown}”`;
        }
        case "matrixRoomPropertyData": {
            return property.displayName?.trim() || fallbackText;
        }
        default:
            return fallbackText;
    }
}

/** The web apps that can open in an area (YouTube, Google Docs...), each as an "Open a website" with a preset. */
export const WEB_APP_SUBTYPES = [
    "youtube",
    "klaxoon",
    "googleDrive",
    "googleDocs",
    "googleSheets",
    "googleSlides",
    "eraser",
    "excalidraw",
    "cards",
    "tldraw",
] as const;

// Built on the absolute pusher address: PUSHER_URL may be a path like "/", which URL() alone refuses.
const ROOM_AREA_PUSHER_URL = new URL("roomArea", ABSOLUTE_PUSHER_URL).toString();

/**
 * A new property of the given type with its defaults, as today's area editor makes it. Some settings bring a
 * highlight along (a call lights the area up when someone enters), added a moment later as before.
 */
export function createAreaProperty(
    LL: TranslationFunctions,
    type: AreaDataPropertiesKeys,
    subtype?: string
): AreaDataProperty {
    const id = uuid();
    // The highlight goes to the area the setting was added to, even when another area is selected by the time
    // the moment has passed (drawing the next area right away must not light that one up instead).
    const addHighlightLater = () => {
        const target = get(mapEditorSelectedAreaPreviewStore);
        if (!target) return;
        setTimeout(() => {
            if (!target.active) return;
            if (!target.getProperties().find((p) => p.type === "highlight")) {
                target.addProperty(createAreaProperty(LL, "highlight"));
            }
        }, 500);
    };
    switch (type) {
        case "start":
            return { id, type, isDefault: true };
        case "silent":
            addHighlightLater();
            return { id, type, hideButtonLabel: true };
        case "focusable":
            return { id, type, zoom_margin: 0.5, hideButtonLabel: true };
        case "highlight":
            return {
                id,
                type,
                opacity: 0.6,
                gradientWidth: 10,
                duration: 250,
                color: "#000000",
                hideButtonLabel: true,
            };
        case "jitsiRoomProperty":
            addHighlightLater();
            return {
                id,
                type,
                closable: true,
                jitsiRoomConfig: {},
                hideButtonLabel: true,
                roomName: LL.mapEditor.properties.jitsiRoomProperty.label(),
                trigger: ON_ACTION_TRIGGER_ENTER,
            };
        case "livekitRoomProperty":
            addHighlightLater();
            return {
                id,
                type,
                roomName: "",
                livekitRoomConfig: { startWithAudioMuted: false, startWithVideoMuted: false, disableChat: false },
                livekitRoomAdminTag: "",
            };
        case "openWebsite": {
            const placeholders: Record<string, string> = {
                youtube: "https://www.youtube.com/watch?v=Y9ubBWf5w20",
                klaxoon: "https://app.klaxoon.com/",
                googleDrive: "https://drive.google.com/file/d/1DjNjZVbVeQO9EvgONLzCtl6wG-kxSr9Z/preview",
                googleDocs: "https://docs.google.com/document/d/1iFHmKL4HJ6WzvQI-6FlyeuCy1gzX8bWQ83dNlcTzigk/edit",
                googleSheets:
                    "https://docs.google.com/spreadsheets/d/1SBIn3IBG30eeq944OhT4VI_tSg-b1CbB0TV0ejK70RA/edit",
                googleSlides:
                    "https://docs.google.com/presentation/d/1fU4fOnRiDIvOoVXbksrF2Eb0L8BYavs7YSsBmR_We3g/edit",
                eraser: "https://app.eraser.io/workspace/ExSd8Z4wPsaqMMgTN4VU",
                excalidraw: "https://excalidraw.workadventu.re/",
                cards: "https://member.workadventu.re/cards?tenant=<your tenant from cards>&learning=<your leaning from cards>",
                tldraw: "https://tldraw.com/",
            };
            return {
                id,
                type,
                link: "",
                closable: true,
                newTab: false,
                hideButtonLabel: true,
                application: subtype ?? "website",
                placeholder: placeholders[subtype ?? ""] ?? "https://bawes.net",
                allowAPI: false,
                forceNewTab: false,
                policy:
                    subtype === "youtube"
                        ? "fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share;"
                        : undefined,
                width: 50,
                trigger: ON_ACTION_TRIGGER_ENTER,
                hideUrl: false,
                hideTitleBar: false,
            };
        }
        case "playAudio":
            return { id, type, hideButtonLabel: true, audioLink: "", volume: NEW_SOUND_VOLUME };
        case "speakerMegaphone": {
            // The first free "MySpeakerZone<n>": two Stages of a room may not share a name.
            const taken = new Set([...speakerZones().values()].map((name) => name.toLowerCase()));
            let number = 1;
            while (taken.has(`myspeakerzone${number}`)) number++;
            addHighlightLater();
            return { id, type, name: `MySpeakerZone${number}`, chatEnabled: false };
        }
        case "listenerMegaphone": {
            const zones = speakerZones();
            addHighlightLater();
            return { id, type, speakerZoneName: zones.size === 1 ? [...zones.keys()][0] : "", chatEnabled: false };
        }
        case "exit":
            return { id, type, url: "", areaName: "" };
        case "restrictedRightsPropertyData":
            return { id, type, readTags: [], writeTags: [] };
        case "maxUsersInAreaPropertyData":
            return { id, type, maxUsers: 6 };
        case "lockableAreaPropertyData":
            return { id, type, allowedTags: [] };
        case "personalAreaPropertyData":
            return {
                id,
                type,
                accessClaimMode: PersonalAreaAccessClaimMode.enum.dynamic,
                allowedTags: [],
                ownerId: null,
            };
        case "extensionModule":
            if (subtype === undefined) throw new Error("Missing subtype for extensionModule");
            return { id, type, subtype, data: null };
        case "matrixRoomPropertyData":
            return {
                id,
                type,
                shouldOpenAutomatically: false,
                displayName: "",
                resourceUrl: ROOM_AREA_PUSHER_URL,
                serverData: { matrixRoomId: undefined },
            };
        case "tooltipPropertyData":
            return { id, type, content: "", duration: 2 };
        case "openFile":
            return {
                id,
                type,
                link: "",
                name: "",
                closable: true,
                newTab: false,
                hideButtonLabel: true,
                policy: undefined,
                width: 50,
                trigger: ON_ACTION_TRIGGER_ENTER,
                hideUrl: false,
            };
        default:
            throw new Error(`Unknown property type ${type}`);
    }
}

/** An "Open a website" preset for one of the room's own apps (connectionManager.applications). */
export function createAppProperty(app: ApplicationDefinitionInterface): AreaDataProperty {
    return {
        id: uuid(),
        type: "openWebsite",
        application: app.name,
        closable: true,
        buttonLabel: app.name,
        link: "",
        newTab: false,
        placeholder: app.description,
        label: app.name,
        policy: app.policy,
        icon: app.image,
        regexUrl: app.regexUrl,
        targetEmbedableUrl: app.targetUrl,
        forceNewTab: app.forceNewTab,
        allowAPI: app.allowAPI,
        hideUrl: false,
        hideTitleBar: false,
    };
}

function speakerZones(): Map<string, string> {
    const zones = new Map<string, string>();
    gameManager
        .tryGetCurrentGameScene()
        ?.getGameMap()
        .getGameMapAreas()
        ?.getAreas()
        .forEach((area) => {
            const raw = area.properties?.find((property) => property.type === "speakerMegaphone");
            if (!raw) return;
            const parsed = SpeakerMegaphonePropertyData.safeParse(raw);
            if (parsed.success) zones.set(area.id, parsed.data.name);
        });
    return zones;
}
