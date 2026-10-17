import type { AreaData } from "./types";
import { SpeakerMegaphonePropertyData } from "./types";

/**
 * An area setting can be switched off in the map editor (`disabled: true`). It is kept with all its choices,
 * but whatever applies area settings in the game must act as if it were not there.
 */
export function isAreaPropertyActive(property: { disabled?: boolean }): boolean {
    return property.disabled !== true;
}

export function getSpeakerMegaphoneAreaName(
    areas: Map<string, AreaData> = new Map(),
    areaId: string
): string | undefined {
    for (const area of areas.values()) {
        const speakerMegaphonePropertyRaw = area.properties.find(
            (property) => property.type === "speakerMegaphone" && isAreaPropertyActive(property)
        );
        if (speakerMegaphonePropertyRaw) {
            const speakerMegaphoneProperty = SpeakerMegaphonePropertyData.safeParse(speakerMegaphonePropertyRaw);
            if (speakerMegaphoneProperty.success && area.id === areaId) {
                return speakerMegaphoneProperty.data.name;
            }
        }
    }
    return undefined;
}
