/**
 * Drafts of the message composer, kept per conversation in this tab's memory only, so two tabs of the
 * same account (clones) never overwrite each other's drafts.
 *
 * A draft written in the proximity chat is tied to the space it was written in: once that bubble or meeting
 * is left, the draft is dropped instead of showing up, ready to send, in the next group.
 */

export interface ComposerDraft {
    /** The composer's content (it may contain <br> tags for new lines). */
    message: string;
    replyingToMessageId: string | null;
    /** The proximity space generation the draft was written in; undefined for other rooms. */
    spaceGeneration?: number;
}

function isBlank(message: string): boolean {
    return message.replace(/<br\s*\/?>/gi, "").trim().length === 0;
}

export class ComposerDraftStore {
    private readonly drafts = new Map<string, ComposerDraft>();

    /** Keeps the draft of a conversation; an empty draft removes it. */
    save(roomId: string, draft: ComposerDraft): void {
        if (isBlank(draft.message) && draft.replyingToMessageId === null) {
            this.drafts.delete(roomId);
            return;
        }
        this.drafts.set(roomId, { ...draft });
    }

    /**
     * The draft of a conversation. A draft written in another space generation than the current one
     * is dropped and not returned.
     */
    load(roomId: string, currentSpaceGeneration?: number): ComposerDraft | undefined {
        const draft = this.drafts.get(roomId);
        if (!draft) return undefined;
        if (draft.spaceGeneration !== undefined && draft.spaceGeneration !== currentSpaceGeneration) {
            this.drafts.delete(roomId);
            return undefined;
        }
        return { ...draft };
    }

    /**
     * Removes the draft once its message was sent (or dropped), unless the draft has changed since,
     * so a newer draft written while a file was uploading is kept.
     */
    clearIfUnchanged(roomId: string, message: string): void {
        const draft = this.drafts.get(roomId);
        if (draft && draft.message === message) {
            this.drafts.delete(roomId);
        }
    }

    clear(roomId: string): void {
        this.drafts.delete(roomId);
    }
}

/** This tab's drafts. Never persisted, never shared with other tabs. */
export const composerDraftStore = new ComposerDraftStore();
