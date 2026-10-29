import type { MatrixChatMessage } from "./MatrixChatMessage";

/**
 * How long a gallery waits for its missing messages when they are posted live. They are sent back to back, so this
 * only matters when one is late or lost; after it the gallery is shown with what arrived.
 */
export const MEDIA_GROUP_WAIT_MS = 4000;

interface Held {
    members: Map<number, MatrixChatMessage>;
    count: number;
    isFresh: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Joins the messages that carry the same media group tag into one gallery message: the first of them stays in the
 * list, the others are kept inside it. Only the same sender can join a group.
 */
export class MediaGroupAssembler {
    private readonly held = new Map<string, Held>();
    /** Groups already shown: a message that comes in late is shown on its own, never lost. */
    private readonly shown = new Set<string>();

    /** `show` gets a gallery that was held while it waited for its last messages. */
    constructor(
        private readonly show: (lead: MatrixChatMessage, isFresh: boolean) => void,
        private readonly waitMs = MEDIA_GROUP_WAIT_MS
    ) {}

    private static key(message: MatrixChatMessage): string | undefined {
        const tag = message.groupTag;
        return tag ? `${message.senderId ?? ""}|${tag.id}` : undefined;
    }

    /** Messages read from the history, oldest first: whole groups are joined at once, nothing is held. */
    joinHistory(messages: MatrixChatMessage[]): MatrixChatMessage[] {
        const groups = new Map<string, MatrixChatMessage[]>();
        const out: Array<MatrixChatMessage | string> = [];
        for (const message of messages) {
            const key = MediaGroupAssembler.key(message);
            if (key === undefined) {
                out.push(message);
                continue;
            }
            const members = groups.get(key);
            if (members) {
                members.push(message);
                continue;
            }
            groups.set(key, [message]);
            out.push(key);
        }
        return out.map((item) => {
            if (typeof item !== "string") return item;
            const members = MediaGroupAssembler.ordered(groups.get(item) ?? []);
            MediaGroupAssembler.join(members);
            return members[0];
        });
    }

    /**
     * A message that just arrived. Returns what to add to the list now: the message itself, or a finished gallery.
     * A message that is part of a gallery still waiting for its other messages is held (nothing is returned).
     */
    addLive(message: MatrixChatMessage, isFresh = true): MatrixChatMessage | undefined {
        const key = MediaGroupAssembler.key(message);
        const tag = message.groupTag;
        if (key === undefined || tag === undefined || this.shown.has(key)) return message;
        let held = this.held.get(key);
        if (!held) {
            held = { members: new Map(), count: tag.count, isFresh, timer: undefined };
            this.held.set(key, held);
            held.timer = setTimeout(() => this.release(key), this.waitMs);
        }
        held.members.set(tag.index, message);
        if (held.members.size >= held.count) return this.release(key, false);
        return undefined;
    }

    dispose() {
        for (const held of this.held.values()) clearTimeout(held.timer);
        this.held.clear();
    }

    private release(key: string, announce = true): MatrixChatMessage | undefined {
        const held = this.held.get(key);
        if (!held) return undefined;
        clearTimeout(held.timer);
        this.held.delete(key);
        this.shown.add(key);
        const members = MediaGroupAssembler.ordered([...held.members.values()]);
        MediaGroupAssembler.join(members);
        if (announce) this.show(members[0], held.isFresh);
        return members[0];
    }

    private static ordered(members: MatrixChatMessage[]): MatrixChatMessage[] {
        return [...members].sort((a, b) => (a.groupTag?.index ?? 0) - (b.groupTag?.index ?? 0));
    }

    private static join(members: MatrixChatMessage[]) {
        if (members.length >= 2) members[0].joinGroup(members);
    }
}
