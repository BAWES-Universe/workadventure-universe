import chroma from "chroma-js";

interface PaletteColor {
    code: string;
    color: string;
}
export const getHslColor = (color: string): string => {
    const hsl = chroma(color).hsl();
    if (isNaN(hsl[0])) {
        hsl[0] = 0;
    }
    return `${Math.round(hsl[0])} ${Math.round(hsl[1] * 100) ?? 0}% ${Math.round(hsl[2] * 100)}%`;
};

/**
 * Builds a 12-step scale from white through `hex` to black.
 * By default the base step lands a little toward white (#000000 gives #171717). With `exactBase`, the base step is
 * `hex` itself, so a map's backgroundColor is exactly the colour of the game's panels.
 */
export const getPalette = (hex: string | null | undefined, exactBase = false) => {
    if (!hex) {
        return [];
    }
    let scale = chroma.scale(["white", hex, "black"]);
    if (exactBase) {
        // colors(12) samples at i / 11; the base step is i = 5.
        scale = scale.domain([0, 5 / 11, 1]);
    }
    const colors = scale.colors(12, "hex");
    const palette: PaletteColor[] = [];
    // Create 50
    palette.push({ code: "-50", color: getHslColor(colors[1]) });
    // Create 100-900
    for (let i = 0.1; i < 0.9; i += 0.1) {
        let step = `-${Math.round(i * 1000)}`;
        if (i == 0.5) {
            step = "";
        }
        palette.push({ code: step, color: getHslColor(colors[Math.round(i * 10)]) });
    }
    return palette;
};

export const getStringPalette = (hex: string | null | undefined, prefix: string, exactBase = false): string => {
    const palette = getPalette(hex, exactBase);
    let stringPalette = "";
    for (const color of palette) {
        stringPalette += `--${prefix}${color.code}: ${color.color};\n`;
    }
    return stringPalette;
};

export const wrapWithStyleTag = (stringPalette: string): string => {
    return `<style>\n
        :root {\n
            ${stringPalette}
            }\n
        </style>`;
};
