import type { Readable } from "svelte/store";

export interface ViewerPages {
    /** The page in view, counted from 1. */
    page: number;
    count: number;
}

export interface ViewerSearch {
    /** Looks for the text and jumps to the first match. */
    find(query: string): void;
    /** Jumps to the next match (or the previous one). */
    next(backwards: boolean): void;
    /** Clears the highlights. */
    clear(): void;
    /** The match in view and how many there are, or undefined before a search. */
    matches: Readable<{ current: number; total: number } | undefined>;
}

/**
 * What a reader (PDF, picture, and later the others) offers the viewer's toolbar. A reader fills in only what it can
 * do: the toolbar shows a button for each thing present.
 */
export interface ViewerController {
    pages?: Readable<ViewerPages>;
    /** Zoom in percent, as shown between the minus and plus buttons. */
    zoomPercent?: Readable<number>;
    zoomIn?: () => void;
    zoomOut?: () => void;
    fitWidth?: () => void;
    rotate?: () => void;
    /** Prints the file. Resolves when the print dialog has been handed the pages. */
    print?: () => Promise<void>;
    search?: ViewerSearch;
    /** The page list, shown or hidden. Only readers with pages have one. */
    pageList?: { shown: Readable<boolean>; toggle: () => void };
}
