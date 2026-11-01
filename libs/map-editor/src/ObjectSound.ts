import type { PlayAudioPropertyData } from "./types";

/** An object's "Play a sound", with every choice filled in (#1627). */
export interface ObjectSoundSettings {
    startsOn: "click" | "range";
    heardBy: "clicker" | "range" | "map";
    loop: boolean;
    /** In tiles */
    fullVolumeWithin: number;
    /** In tiles, never below fullVolumeWithin */
    heardUpTo: number;
    /** In seconds, counted from when the sound ends */
    clickWait: number;
    volume: number;
}

/** What a new object sound starts with, as on the approved mock: a fireplace or a waterfall. */
export const NEW_OBJECT_SOUND: Required<
    Pick<PlayAudioPropertyData, "startsOn" | "heardBy" | "loop" | "fullVolumeWithin" | "heardUpTo" | "clickWait">
> = {
    startsOn: "range",
    heardBy: "clicker",
    loop: true,
    fullVolumeWithin: 1,
    heardUpTo: 5,
    clickWait: 0,
};

/**
 * The choices of an object's sound. An object sound saved before #1627 plays on click for the person who clicked,
 * as it always did. A sound made in upstream WorkAdventure for everyone keeps playing for everyone, within its
 * radius when it has one.
 */
export function objectSoundSettings(property: PlayAudioPropertyData, tileSize: number): ObjectSoundSettings {
    const startsOn = property.startsOn ?? "click";
    let heardBy = property.heardBy;
    let fullVolumeWithin = property.fullVolumeWithin;
    let heardUpTo = property.heardUpTo;
    if (heardBy === undefined && property.playForAllUsers) {
        const radius = property.audibleRadius ?? undefined;
        heardBy = radius === undefined ? "map" : "range";
        if (radius !== undefined && heardUpTo === undefined) {
            fullVolumeWithin = fullVolumeWithin ?? 0;
            heardUpTo = radius / tileSize;
        }
    }
    fullVolumeWithin = finiteAtLeastZero(fullVolumeWithin, NEW_OBJECT_SOUND.fullVolumeWithin);
    heardUpTo = Math.max(fullVolumeWithin, finiteAtLeastZero(heardUpTo, NEW_OBJECT_SOUND.heardUpTo));
    return {
        startsOn,
        heardBy: heardBy ?? "clicker",
        loop: property.loop ?? false,
        fullVolumeWithin,
        heardUpTo,
        clickWait: finiteAtLeastZero(property.clickWait, 0),
        volume: Math.max(0, Math.min(1, property.volume ?? 1)),
    };
}

/** Whether the distance matters for who hears this sound */
export function objectSoundHasRange(settings: ObjectSoundSettings): boolean {
    return settings.startsOn === "range" || settings.heardBy === "range";
}

/**
 * How loud the sound is at this distance from the object, from 0 (silent) to 1 (full volume): full within
 * fullVolumeWithin tiles, then fading out smoothly, silent from heardUpTo tiles.
 */
export function objectSoundGain(settings: ObjectSoundSettings, distanceInTiles: number): number {
    if (!objectSoundHasRange(settings)) {
        return 1;
    }
    if (distanceInTiles <= settings.fullVolumeWithin) {
        return 1;
    }
    if (distanceInTiles >= settings.heardUpTo) {
        return 0;
    }
    const t = (distanceInTiles - settings.fullVolumeWithin) / (settings.heardUpTo - settings.fullVolumeWithin);
    return 1 - t * t * (3 - 2 * t);
}

function finiteAtLeastZero(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}
