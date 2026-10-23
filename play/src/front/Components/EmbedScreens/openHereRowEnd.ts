/** The key the container gives the row of every item under (setContext), as a store of what the row ends with. */
export const OPEN_HERE_ROW_END = "openHereRowEnd";

/**
 * What the row of an item ends with in a phone's sheet, which has no strip of tabs: the "N open" chip, when more than
 * one item is open, and chat's own close. Undefined where the window has its own pill and strip.
 */
export interface OpenHereRowEnd {
    count: number;
    listOpen: boolean;
    toggleList: () => void;
    close: () => void;
}
