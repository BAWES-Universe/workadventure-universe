import type { Writable } from "svelte/store";
import { writable } from "svelte/store";
import type { ArtifactChat } from "../../Artifacts/ArtifactApi";
import type { ArtifactKind } from "../../Artifacts/artifactCard";
import { SimpleCoWebsite } from "./SimpleCoWebsite";

/** What the tabs and the list know about an artifact before and while it opens. */
export interface ArtifactSummary {
    title: string;
    kind: ArtifactKind | undefined;
    makerName: string | undefined;
}

/**
 * A page, mini app or document a bot made, shown beside the map (live artifacts, game #1422). The file is served from
 * an address outside the game's own and runs in a locked frame; the window asks the game's server for it.
 */
export class ArtifactCoWebsite extends SimpleCoWebsite {
    /** The version being looked at; undefined is the latest. */
    readonly version: Writable<number | undefined>;
    readonly summary: Writable<ArtifactSummary>;

    constructor(
        public readonly artifactId: string,
        /** The chat the card was seen in, which the game's server checks before it says the person is in it. */
        public chat: ArtifactChat | undefined,
        summary: ArtifactSummary,
        version?: number
    ) {
        // The file's address comes from the game's server when the window opens, never from this one.
        super(new URL("about:blank"), false, undefined, undefined, true, true);
        this.version = writable(version);
        this.summary = writable(summary);
    }
}
