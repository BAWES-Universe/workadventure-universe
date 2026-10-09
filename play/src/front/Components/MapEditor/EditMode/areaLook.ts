/** The colour of an area with no setting that has a colour of its own (see areaColour). */
const NO_SETTINGS_COLOUR = "6f7dff";

/**
 * The CSS variables that colour an area's frame, fill, halo and label on the editor's map, from the area's own colour
 * (hex without "#", as areaColour gives it).
 */
export function areaLook(hex: string = NO_SETTINGS_COLOUR): string {
    const value = Number.parseInt(hex, 16);
    const rgb = Number.isNaN(value) ? [111, 125, 255] : [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    const colour = (alpha: number) => `rgba(${rgb.join(", ")}, ${alpha})`;
    const text = Number.isNaN(value) ? `#${NO_SETTINGS_COLOUR}` : `#${hex}`;
    return `--af-c: ${colour(0.95)}; --af-halo: ${colour(0.26)}; --af-fill: ${colour(0.24)}; --af-t: ${text};`;
}
