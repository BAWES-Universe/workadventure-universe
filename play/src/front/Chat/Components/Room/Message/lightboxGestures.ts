/**
 * The maths behind the chat picture viewer (Lightbox.svelte).
 *
 * The picture sits in the middle of the viewer and is moved with `translate(tx, ty) scale(scale)` around its centre.
 * All points are in the viewer's own coordinates (0,0 is its top-left corner). Keeping the maths here, without the
 * DOM, lets the unit tests check the edge cases exactly.
 */

export interface View {
    scale: number;
    tx: number;
    ty: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export const MIN_SCALE = 1;
/** Lowest zoom limit, even for a small picture. */
export const MIN_MAX_SCALE = 5;
/** Highest zoom limit, even for a very large picture. */
export const MAX_MAX_SCALE = 12;
/** A double tap on an ordinary picture zooms to this. */
export const DOUBLE_TAP_SCALE = 2.5;
/** A picture at least this many times wider than tall (or taller than wide) counts as wide or tall. */
export const STRIP_RATIO = 3;
/** How much of a pull past an edge is shown. The rest is lost, so the edge feels stretchy. */
export const RUBBER_FACTOR = 0.35;

export function clamp(value: number, limit: number): number {
    return Math.max(-limit, Math.min(limit, value));
}

/** A pull past `limit` only moves a part of the way, so it feels stretchy. Inside the limit nothing changes. */
export function rubberBand(value: number, limit: number): number {
    if (value > limit) return limit + (value - limit) * RUBBER_FACTOR;
    if (value < -limit) return -limit + (value + limit) * RUBBER_FACTOR;
    return value;
}

/**
 * How far the picture may be moved from the centre at this zoom, per direction.
 * A picture that is smaller than the viewer in a direction has no room to move that way, so it stays centred.
 */
export function panBounds(fit: Size, stage: Size, scale: number): Point {
    return {
        x: Math.max(0, (fit.width * scale - stage.width) / 2),
        y: Math.max(0, (fit.height * scale - stage.height) / 2),
    };
}

/** How many times the picture's own pixels fit its on-screen size, one picture pixel per screen point. */
export function realSizeScale(fit: Size, natural: Size): number {
    if (fit.width <= 0 || natural.width <= 0) return 1;
    return natural.width / fit.width;
}

/** The zoom limit: twice the picture's real size, but at least 5 times and at most 12 times. */
export function maxScaleFor(realScale: number): number {
    return Math.min(MAX_MAX_SCALE, Math.max(MIN_MAX_SCALE, 2 * realScale));
}

/** Where a double tap zooms to: real size for a very wide or tall picture, 2.5 times for every other one. */
export function doubleTapScaleFor(natural: Size, realScale: number, maxScale: number): number {
    if (natural.width <= 0 || natural.height <= 0) return Math.min(maxScale, DOUBLE_TAP_SCALE);
    const ratio = natural.width / natural.height;
    const strip = ratio >= STRIP_RATIO || ratio <= 1 / STRIP_RATIO;
    if (!strip) return Math.min(maxScale, DOUBLE_TAP_SCALE);
    return Math.min(maxScale, Math.max(DOUBLE_TAP_SCALE, realScale));
}

/** Zoom to `target`, keeping the part of the picture under `point` under it. */
export function zoomAround(view: View, point: Point, target: number, stage: Size): View {
    const cx = stage.width / 2;
    const cy = stage.height / 2;
    // The spot of the picture (in its own unzoomed coordinates, from its centre) that is under the point now.
    const px = (point.x - cx - view.tx) / view.scale;
    const py = (point.y - cy - view.ty) / view.scale;
    return {
        scale: target,
        tx: point.x - cx - px * target,
        ty: point.y - cy - py * target,
    };
}

/** Pulls the picture back inside its limits and puts it in the centre when it is at normal size. */
export function settleView(view: View, fit: Size, stage: Size, maxScale: number): View {
    if (view.scale <= MIN_SCALE + 0.01) return { scale: MIN_SCALE, tx: 0, ty: 0 };
    const scale = Math.min(maxScale, view.scale);
    const bounds = panBounds(fit, stage, scale);
    return { scale, tx: clamp(view.tx, bounds.x), ty: clamp(view.ty, bounds.y) };
}

/** Dragging to close counts when it went far enough, or was a quick flick the way it moved. */
export function shouldCloseByDrag(dy: number, velocityY: number, stageHeight: number): boolean {
    const distance = Math.abs(dy);
    if (distance > stageHeight * 0.25) return true;
    // Fast flicks only count after a small real move, and only in the direction the picture was dragged.
    return distance > 48 && Math.abs(velocityY) > 0.6 && Math.sign(velocityY) === Math.sign(dy);
}

/** A box on the screen, as `getBoundingClientRect()` gives it. */
export interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/**
 * True when a point of the screen is on the dark background, outside the picture as it is shown now (zoomed and moved
 * or not). No picture on screen yet means every point is on the background.
 */
export function isOnBackground(point: Point, picture: Box | undefined): boolean {
    if (!picture || picture.right <= picture.left || picture.bottom <= picture.top) return true;
    return point.x < picture.left || point.x > picture.right || point.y < picture.top || point.y > picture.bottom;
}
