import { SimpleCoWebsite } from "./SimpleCoWebsite";

/**
 * Your artifacts, every one you own from every bot and chat, as an item of the window (game #1609). Orbit's View all
 * and a chat's "All your artifacts" open it; each artifact tapped there opens as its own item beside it.
 */
export class YourArtifactsCoWebsite extends SimpleCoWebsite {
    constructor() {
        // The list is read from the game's server; there is no page to load.
        super(new URL("about:blank"), false, undefined, undefined, true, true);
    }
}
