export interface Size {
    width: number;
    height: number;
}

/**
 * The size a picture is drawn at (before any zoom). Some browsers report 0 for a vector picture that names no size
 * of its own, only a view box; it is then drawn to fill the panel, which its view box scales to fit.
 */
export function drawnSizeOf(natural: Size, panel: Size): Size {
    if (natural.width > 0 && natural.height > 0) return natural;
    return { width: Math.max(1, panel.width), height: Math.max(1, panel.height) };
}
