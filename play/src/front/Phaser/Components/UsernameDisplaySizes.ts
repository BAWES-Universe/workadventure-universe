/**
 * Layout constants of the player name pill and the badges laid out around it.
 *
 * Every length is in game pixels at the pill's base size: it is multiplied by `--username-dom-scale` at render
 * time. `f` in the design notes is the font size, so a length of `n * f` is `n * PLAYER_NAME_FONT_SIZE` here.
 */

/** Font size of the name (`f`). */
export const PLAYER_NAME_FONT_SIZE = 10;

/** Height of the pill: 1.6f. */
export const PLAYER_NAME_HEIGHT = PLAYER_NAME_FONT_SIZE * 1.6;

/** Gap between the pill's children: .42f. */
export const PLAYER_NAME_GAP = PLAYER_NAME_FONT_SIZE * 0.42;

/** Padding at the left (next to the status dot) and at the right of the pill: .5f and .7f. */
export const PLAYER_NAME_PADDING_LEFT = PLAYER_NAME_FONT_SIZE * 0.5;
export const PLAYER_NAME_PADDING_RIGHT = PLAYER_NAME_FONT_SIZE * 0.7;

/** Diameter of the status dot, border included: .72f. */
export const STATUS_DOT_SIZE = PLAYER_NAME_FONT_SIZE * 0.72;

/** The status dot's border is at least one screen pixel and at most .12f. */
export const STATUS_DOT_BORDER_WIDTH = PLAYER_NAME_FONT_SIZE * 0.12;

/** Side of the (square) megaphone icon. */
export const MEGAPHONE_ICON_SIZE = PLAYER_NAME_HEIGHT * 0.75;

/** The talk bubble: 2.4f x 1.55f, with a tail of .45f and dots of .3f. */
export const TALK_BUBBLE_WIDTH = PLAYER_NAME_FONT_SIZE * 2.4;
export const TALK_BUBBLE_HEIGHT = PLAYER_NAME_FONT_SIZE * 1.55;
export const TALK_BUBBLE_TAIL_SIZE = PLAYER_NAME_FONT_SIZE * 0.45;
export const TALK_BUBBLE_DOT_SIZE = PLAYER_NAME_FONT_SIZE * 0.3;

/** Distance between the pill's bottom and the Woka's origin, in game pixels (the pill stands 18 game px above it). */
export const PLAYER_NAME_OFFSET_Y = -18;

/**
 * When one game pixel is smaller than one screen pixel (zoomed out), the name shrinks with the map, but only down to
 * this rate. Past it, the name keeps its screen size so it stays readable.
 */
export const CORRECTION_RATE = 0.65;

/** The name never grows beyond this font size on screen (CSS pixels), however far the map is zoomed in. */
export const MAX_FONT_SIZE_ON_SCREEN = 13;

/** Safety cut: names longer than this show their first MAX_NAME_LENGTH - 1 letters and "…", until hovered. */
export const MAX_NAME_LENGTH = 32;
