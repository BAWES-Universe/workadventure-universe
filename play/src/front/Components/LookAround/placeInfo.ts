import type { ComponentType } from "svelte";
import type { AreaDataProperty, EntityDataProperty } from "@workadventure/map-editor";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import { Entity } from "../../Phaser/ECS/Entity";
import { AreaPreview } from "../../Phaser/Components/MapEditor/AreaPreview";
import {
    IconDesk,
    IconDoorIn,
    IconDoorOut,
    IconEar,
    IconFile,
    IconFileMusic,
    IconFocus,
    IconLamp,
    IconLink,
    IconLockCog,
    IconMessage,
    IconMicrophone,
    IconMicrophoneOff,
    IconTexture,
    IconTooltip,
    IconUsersGroup,
    IconZoomInArea,
} from "@wa-icons";

/** A place of the room as the Places panel and the place card show it: an area or an object. */
export type Place = Entity | AreaPreview;

export interface PlaceMainProperty {
    type: string;
    application?: string;
}

/** The property a place is known by: its first one that is not the description. */
export function getPlaceMainProperty(place: Place): PlaceMainProperty | undefined {
    const properties: ReadonlyArray<EntityDataProperty | AreaDataProperty> =
        place instanceof AreaPreview ? place.getAreaData().properties : place.getProperties();
    const property = properties.find((p) => p.type !== "areaDescriptionProperties");
    if (!property) return undefined;
    const application = "application" in property ? (property as { application?: string }).application : undefined;
    return { type: property.type, application };
}

const ICONS: Record<string, ComponentType> = {
    personalAreaPropertyData: IconDesk,
    restrictedRightsPropertyData: IconLockCog,
    focusable: IconZoomInArea,
    highlight: IconFocus,
    silent: IconMicrophoneOff,
    jitsiRoomProperty: IconUsersGroup,
    livekitRoomProperty: IconUsersGroup,
    speakerMegaphone: IconMicrophone,
    listenerMegaphone: IconEar,
    start: IconDoorIn,
    exit: IconDoorOut,
    playAudio: IconFileMusic,
    openWebsite: IconLink,
    openFile: IconFile,
    matrixRoomPropertyData: IconMessage,
    tooltipPropertyData: IconTooltip,
};

/** The icon of a place: its main property's, else the generic area or object icon. */
export function getPlaceIcon(place: Place): ComponentType {
    const property = getPlaceMainProperty(place);
    if (property && ICONS[property.type]) return ICONS[property.type];
    return place instanceof AreaPreview ? IconTexture : IconLamp;
}

/**
 * The name shown for a place: its own name, else the object's prefab name. An area without a name is "Unnamed area",
 * as the editor calls it; what it does shows on the line under the name, not as its name.
 */
export function getPlaceName(place: Place, ll: TranslationFunctions): string {
    if (place instanceof Entity) {
        const name = place.getEntityData().name;
        return name && name !== "" ? name : place.getPrefab().name;
    }
    const name = place.getAreaData().name;
    if (name && name !== "") return name;
    return ll.mapEditor.edit.areas.unnamed();
}

/**
 * What a setting is called, in the words the editor uses for it ("Video call", "Quiet zone", "Highlight"...), so Look
 * around and the editor say the same. An app of "Open a website" keeps its own name (YouTube...).
 */
export function getSettingTitle(type: string, ll: TranslationFunctions, application?: string): string | undefined {
    const labels = ll.mapEditor.properties as unknown as Record<string, { label?: () => string } | undefined>;
    if (type === "openWebsite" && application && application !== "website") {
        const app = labels[application];
        if (app && typeof app.label === "function") return app.label();
    }
    const titles = ll.mapEditor.edit.properties as unknown as Record<string, { title?: () => string } | undefined>;
    const title = titles[type];
    if (title && typeof title.title === "function") return title.title();
    const label = labels[type];
    if (label && typeof label.label === "function") return label.label();
    return undefined;
}

/** What the main property is called in the user's language ("Video call", "Exit to a room"...), if it has a name. */
export function getPlacePropertyLabel(place: Place, ll: TranslationFunctions): string | undefined {
    const property = getPlaceMainProperty(place);
    if (!property) return undefined;
    return getSettingTitle(property.type, ll, property.application);
}

/** True if the place matches a property filter (a property type, or an application name for websites). */
export function placeHasProperty(place: Place, filter: string): boolean {
    const properties: ReadonlyArray<EntityDataProperty | AreaDataProperty> =
        place instanceof AreaPreview ? place.getAreaData().properties : place.getProperties();
    return properties.some(
        (p) => p.type === filter || ("application" in p && (p as { application?: string }).application === filter)
    );
}

/** The text a search box matches against: the name, the prefab name, the property label and the description. */
export function getPlaceSearchText(place: Place, ll: TranslationFunctions): string {
    const parts = [getPlaceName(place, ll), getPlacePropertyLabel(place, ll) ?? "", place.description ?? ""];
    if (place instanceof Entity) parts.push(place.getPrefab().name);
    return parts.join(" ").toLowerCase();
}

/** The rectangle of a place in world pixels. */
export function getPlaceRect(place: Place): { x: number; y: number; width: number; height: number } {
    if (place instanceof AreaPreview) {
        const data = place.getAreaData();
        return { x: data.x, y: data.y, width: data.width, height: data.height };
    }
    return {
        x: place.x - place.displayWidth / 2,
        y: place.y - place.displayHeight / 2,
        width: place.displayWidth,
        height: place.displayHeight,
    };
}
