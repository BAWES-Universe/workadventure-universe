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

/** The name shown for a place: its own name, else the object's prefab name, else what its main property is called. */
export function getPlaceName(place: Place, ll: TranslationFunctions): string {
    if (place instanceof Entity) {
        const name = place.getEntityData().name;
        return name && name !== "" ? name : place.getPrefab().name;
    }
    const name = place.getAreaData().name;
    if (name && name !== "") return name;
    return getPlacePropertyLabel(place, ll) ?? ll.mapEditor.lookAround.area();
}

/** What the main property is called in the user's language ("Video call", "Exit"...), if it has a label. */
export function getPlacePropertyLabel(place: Place, ll: TranslationFunctions): string | undefined {
    const property = getPlaceMainProperty(place);
    if (!property) return undefined;
    const properties = ll.mapEditor.properties as unknown as Record<string, { label?: () => string } | undefined>;
    let key = property.type;
    if (property.type === "openWebsite" && property.application && property.application !== "website") {
        key = property.application;
    }
    const translation = properties[key];
    if (translation && typeof translation.label === "function") return translation.label();
    return undefined;
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
