import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { fetchChatArtifacts, fetchYourArtifacts } from "./ArtifactApi";
import type { ArtifactChat, ChatArtifact, ChatArtifactPage } from "./ArtifactApi";

/** A chat's artifacts as far as they were read, for its Artifacts group and page (game #1474). */
export interface ChatArtifactsState {
    artifacts: ChatArtifact[];
    /** How many there are in all, read or not. */
    total: number;
    /** Where the next page starts; null once all are read. */
    next: number | null;
    loading: boolean;
    /** The last read failed: what was read before stays. */
    failed: boolean;
    /** At least one page came back. */
    loaded: boolean;
}

const NOTHING_YET: ChatArtifactsState = {
    artifacts: [],
    total: 0,
    next: null,
    loading: false,
    failed: false,
    loaded: false,
};

/** A list of artifacts read from the game's server a page at a time: a chat's, or all of yours. */
export class ArtifactsList implements Readable<ChatArtifactsState> {
    private readonly state = writable<ChatArtifactsState>(NOTHING_YET);
    private reading = 0;
    /** Where the last read started, so a failed one can be asked again. */
    private lastOffset = 0;
    readonly subscribe = this.state.subscribe;

    constructor(private readonly fetchFrom: (offset: number) => Promise<ChatArtifactPage>) {}

    /** The newest ones again, from the top. */
    refresh(): Promise<void> {
        return this.read(0);
    }

    /** The next page, if there is one and nothing is being read. */
    loadMore(): Promise<void> {
        const { next, loading } = get(this.state);
        if (next === null || loading) return Promise.resolve();
        return this.read(next);
    }

    /** The read that failed, again. */
    retry(): Promise<void> {
        return this.read(this.lastOffset);
    }

    private async read(offset: number): Promise<void> {
        const reading = ++this.reading;
        this.lastOffset = offset;
        this.state.update((state) => ({ ...state, loading: true, failed: false }));
        try {
            const page = await this.fetchFrom(offset);
            if (reading !== this.reading) return;
            this.state.update((state) => {
                // One that changed between two pages moved up: it shows once, where it is now
                const before = offset === 0 ? [] : state.artifacts;
                const seen = new Set(before.map((artifact) => artifact.id));
                return {
                    artifacts: [...before, ...page.artifacts.filter((artifact) => !seen.has(artifact.id))],
                    total: page.total,
                    next: page.next,
                    loading: false,
                    failed: false,
                    loaded: true,
                };
            });
        } catch (error) {
            if (reading !== this.reading) return;
            console.error("Could not read the artifacts", error);
            this.state.update((state) => ({ ...state, loading: false, failed: true }));
        }
    }
}

/**
 * One chat's artifacts. The group on the details reads the first page each time it shows, and the page with all of
 * them reads on from there, so both show the same list.
 */
export class ChatArtifactsList extends ArtifactsList {
    constructor(
        readonly chat: ArtifactChat,
        fetchPage: (chat: ArtifactChat, offset: number) => Promise<ChatArtifactPage> = fetchChatArtifacts
    ) {
        super((offset) => fetchPage(chat, offset));
    }
}

let yours: ArtifactsList | undefined;

/** Every artifact this person owns, from every chat and bot (Your artifacts in the window, game #1609). */
export function yourArtifactsList(): ArtifactsList {
    yours ??= new ArtifactsList(fetchYourArtifacts);
    return yours;
}

/** The chats whose lists are kept while the game runs; the oldest goes first past this many. */
const KEPT_LISTS = 20;
const lists = new Map<string, ChatArtifactsList>();

/** The list of this chat, the same one for its group and its page. */
export function chatArtifactsList(chat: ArtifactChat): ChatArtifactsList {
    const key = `${chat.kind}:${chat.ref}`;
    const kept = lists.get(key);
    if (kept) {
        lists.delete(key);
        lists.set(key, kept);
        return kept;
    }
    const list = new ChatArtifactsList(chat);
    lists.set(key, list);
    if (lists.size > KEPT_LISTS) lists.delete(lists.keys().next().value as string);
    return list;
}
