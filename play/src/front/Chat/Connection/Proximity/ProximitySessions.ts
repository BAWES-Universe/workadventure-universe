/**
 * Pure logic behind the session dividers of the proximity timeline.
 *
 * The proximity chat is one long-lived timeline across every bubble and meeting. Each time this tab's avatar
 * joins a group, a typed start marker is written; leaving writes an end marker. The view never detects them
 * by their (translated) text: only the `session` field counts. Everything stays local to this tab.
 */

export interface ProximitySessionMarker {
    /** "start" when this tab joined a group or a meeting area, "end" when it left. */
    kind: "start" | "end";
    /** The group's names ("Sara & Omar") or the meeting area's name ("Design room"). */
    label: string;
    /** The names of the people in the group when it started. Empty for a meeting area. */
    participants: string[];
    /**
     * One id per stay: the start and end markers of the same stay share it. Undefined on markers written
     * before ids existed (carried timelines), which are then paired by order.
     */
    sessionId?: string;
    /** The space user ids of the people in the group, in the same order as `participants`. */
    participantIds?: string[];
    /** True for a meeting area or zone: the label is the place's name. */
    isArea?: boolean;
    /** On an end marker: the text the composer still held when the stay ended. */
    unsentDraft?: string;
}

export interface SessionTimelineMessage {
    id: string;
    date: Date | null;
    session?: ProximitySessionMarker;
    type?: string;
}

/** "resume": the start of a later stay that carried on the same conversation (you came back to the same people). */
export type TimelineEntryRole = "start" | "end" | "message" | "resume";

export interface TimelineEntry<M extends SessionTimelineMessage> {
    message: M;
    role: TimelineEntryRole;
    /** 0 for messages written before any start marker, then 1, 2, … for each group. */
    sessionIndex: number;
    /** True for the start marker and messages of the group this tab is in right now. */
    isCurrentSession: boolean;
}

/**
 * Splits the timeline into sessions. The current session is the last one that started at or after the
 * moment the current space was joined and has not ended; with no space joined, no session is current.
 */
export function buildTimelineEntries<M extends SessionTimelineMessage>(
    messages: readonly M[],
    currentSpaceJoinedAt: number | undefined
): TimelineEntry<M>[] {
    let currentSessionIndex = -1;
    if (currentSpaceJoinedAt !== undefined) {
        let sessionIndex = 0;
        let lastStartIndex = -1;
        let lastStartIsRecent = false;
        let endedSinceLastStart = false;
        for (const message of messages) {
            if (message.session?.kind === "start") {
                sessionIndex++;
                lastStartIndex = sessionIndex;
                lastStartIsRecent = message.date !== null && message.date.getTime() >= currentSpaceJoinedAt;
                endedSinceLastStart = false;
            } else if (message.session?.kind === "end") {
                endedSinceLastStart = true;
            }
        }
        if (lastStartIndex !== -1 && lastStartIsRecent && !endedSinceLastStart) {
            currentSessionIndex = lastStartIndex;
        }
    }

    const entries: TimelineEntry<M>[] = [];
    let sessionIndex = 0;
    for (const message of messages) {
        if (message.session?.kind === "start") {
            sessionIndex++;
        }
        const role: TimelineEntryRole = message.session ? message.session.kind : "message";
        entries.push({
            message,
            role,
            sessionIndex,
            isCurrentSession: sessionIndex === currentSessionIndex,
        });
    }
    return entries;
}

/**
 * Where a message that could not be sent goes back into the timeline: right before the first session marker
 * written after it was submitted (the end of its own group), so it never reads as part of a later group.
 * Appended at the end when no marker came after it.
 */
export function findNotSentInsertIndex(messages: readonly SessionTimelineMessage[], submittedAt: Date): number {
    const submittedTime = submittedAt.getTime();
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.session && message.date !== null && message.date.getTime() >= submittedTime) {
            return index;
        }
    }
    return messages.length;
}

export interface SessionDividerTemplates {
    /** "With Sara & Omar" */
    withPeople: (params: { names: string }) => string;
}

/**
 * The text of a start divider: "With Sara & Omar" for a group, the area's name for a meeting.
 */
export function formatSessionDivider(marker: ProximitySessionMarker, templates: SessionDividerTemplates): string {
    if (marker.participants.length > 0) {
        return templates.withPeople({ names: marker.label });
    }
    return marker.label;
}

/** The id of the pseudo-session holding messages written outside any stay (scripts, mostly). */
export const ROOM_MESSAGES_SESSION_ID = "room-messages";

/** Message types that count as something said, as opposed to join/leave notices and markers. */
const NOTICE_TYPES = new Set(["incoming", "outcoming"]);

/**
 * How long you can be away and still carry on the same conversation when you're back with the same people
 * (matched by their id) or in the same meeting area. Long enough for a coffee break, short enough to keep
 * the morning and the afternoon apart.
 */
export const CONTINUE_WITHIN_MS = 15 * 60 * 1000;
/** Shorter when a person can only be matched by name: they reconnected and got a new id. */
export const CONTINUE_BY_NAME_WITHIN_MS = 5 * 60 * 1000;

export interface ContinuationRules {
    withinMs: number;
    byNameWithinMs: number;
}

export const DEFAULT_CONTINUATION: ContinuationRules = {
    withinMs: CONTINUE_WITHIN_MS,
    byNameWithinMs: CONTINUE_BY_NAME_WITHIN_MS,
};

/** No stay ever continues another: each one is its own session. */
export const NO_CONTINUATION: ContinuationRules = { withinMs: -1, byNameWithinMs: -1 };

export interface ProximitySession<M extends SessionTimelineMessage = SessionTimelineMessage> {
    /** The first stay's id, or ROOM_MESSAGES_SESSION_ID for messages outside any stay. */
    id: string;
    /** Every stay of this conversation, in order: one, or more when you came back to the same people. */
    stayIds: string[];
    /** 1, 2, … in timeline order; 0 for the room messages. */
    index: number;
    /** "Sara & Omar", or the area's name. Empty for the room messages. */
    label: string;
    /** Everyone who was in it, at the start or when you left, in order of appearance. */
    participants: string[];
    /** Their space user ids, in the same order ("" when unknown). */
    participantIds: string[];
    isArea: boolean;
    startedAt: number | undefined;
    endedAt: number | undefined;
    /** Every entry of the stay, markers included, in order. */
    entries: TimelineEntry<M>[];
    /** The messages people actually wrote (no markers, no join/leave notices). */
    messages: M[];
    lastMessage: M | undefined;
    unsentDraft: string | undefined;
    /** True while the stay has no end marker. At most one session is live. */
    isLive: boolean;
}

/**
 * Adds people to a session, by name: a person who reconnected (same name, new id) stays one person, with
 * the newest id, so "Walk to" and "Continue with" find the avatar that is around now.
 */
function addPeople(
    session: ProximitySession<SessionTimelineMessage>,
    names: readonly string[],
    ids: readonly string[]
) {
    names.forEach((name, index) => {
        const id = ids[index] ?? "";
        if (name.trim() === "") return;
        const known = session.participants.indexOf(name);
        if (known === -1) {
            session.participants.push(name);
            session.participantIds.push(id);
        } else if (id !== "") {
            session.participantIds[known] = id;
        }
    });
}

/**
 * Whether a stay carries on the conversation of the one before it: back with at least one of the same
 * people (or in the same meeting area) within the window. Nothing else counts, so two chats with different
 * people never merge, whatever the gap.
 */
function continues(
    previous: ProximitySession<SessionTimelineMessage>,
    next: ProximitySession<SessionTimelineMessage>,
    rules: ContinuationRules
): boolean {
    if (previous.id === ROOM_MESSAGES_SESSION_ID || next.id === ROOM_MESSAGES_SESSION_ID) return false;
    if (previous.endedAt === undefined || next.startedAt === undefined) return false;
    const gap = next.startedAt - previous.endedAt;
    if (gap < 0) return false;
    if (previous.isArea || next.isArea) {
        return previous.isArea && next.isArea && previous.label === next.label && gap <= rules.withinMs;
    }
    const sharesId = next.participantIds.some((id) => id !== "" && previous.participantIds.includes(id));
    if (sharesId) return gap <= rules.withinMs;
    const sharesName = next.participants.some((name) => previous.participants.includes(name));
    return sharesName && gap <= rules.byNameWithinMs;
}

/** Appends a stay to the conversation it carries on. Its start marker becomes the "back with" divider. */
function mergeInto<M extends SessionTimelineMessage>(target: ProximitySession<M>, next: ProximitySession<M>) {
    target.stayIds.push(...next.stayIds);
    for (const entry of next.entries) {
        target.entries.push({
            ...entry,
            role: entry.role === "start" ? "resume" : entry.role,
            sessionIndex: target.index,
        });
    }
    target.messages.push(...next.messages);
    if (next.lastMessage) target.lastMessage = next.lastMessage;
    const before = target.participants.length;
    addPeople(target, next.participants, next.participantIds);
    if (target.participants.length !== before && !target.isArea) {
        target.label = target.participants.join(", ");
    }
    target.endedAt = next.endedAt;
    target.isLive = next.isLive;
    // A draft left when you walked away is kept, to go back into the composer once you're back.
    if (next.unsentDraft !== undefined) target.unsentDraft = next.unsentDraft;
}

/**
 * Joins the stays that carry on one conversation: each stay goes to the most recent conversation it continues
 * (same people or place, within the window), even with other chats in between. Going back and forth between
 * two people keeps two chats, not one row per visit. Each chat only shows its own messages, so nothing is
 * reordered. Walk-bys where nobody wrote anything are never continued: they stay as their own, unlisted,
 * sessions.
 */
function continueConversations<M extends SessionTimelineMessage>(
    sessions: ProximitySession<M>[],
    rules: ContinuationRules
): ProximitySession<M>[] {
    const result: ProximitySession<M>[] = [];
    for (const session of sessions) {
        let candidate: ProximitySession<M> | undefined;
        let candidateEnd = -Infinity;
        for (const earlier of result) {
            if (earlier.messages.length === 0 && earlier.unsentDraft === undefined) continue;
            if (!continues(earlier, session, rules)) continue;
            // The most recent one wins (a group can share people with several earlier chats).
            const end = earlier.endedAt ?? -Infinity;
            if (end >= candidateEnd) {
                candidate = earlier;
                candidateEnd = end;
            }
        }
        if (candidate) {
            mergeInto(candidate, session);
        } else {
            result.push(session);
        }
    }
    return result;
}

/**
 * Splits the timeline into stays. Each start marker opens a session that runs until its end marker;
 * messages before the first start or between an end and the next start go to the room messages session.
 * A session with no end marker is live only while a space is joined: an unfinished session of a carried
 * timeline (no space joined now) counts as ended.
 *
 * Coming back to the same people (or the same meeting area) within the continuation window carries on the
 * same session instead of starting another: its stays are listed in `stayIds`, and the later starts become
 * "resume" entries. `drafts` holds the text left in the composer when a stay ended, by stay id.
 */
export function buildProximitySessions<M extends SessionTimelineMessage>(
    messages: readonly M[],
    currentSpaceJoinedAt: number | undefined,
    rules: ContinuationRules = DEFAULT_CONTINUATION,
    drafts?: ReadonlyMap<string, string>
): ProximitySession<M>[] {
    const sessions: ProximitySession<M>[] = [];
    const loose: ProximitySession<M> = {
        id: ROOM_MESSAGES_SESSION_ID,
        stayIds: [ROOM_MESSAGES_SESSION_ID],
        index: 0,
        label: "",
        participants: [],
        participantIds: [],
        isArea: false,
        startedAt: undefined,
        endedAt: undefined,
        entries: [],
        messages: [],
        lastMessage: undefined,
        unsentDraft: undefined,
        isLive: false,
    };
    let open: ProximitySession<M> | undefined;
    let index = 0;

    const add = (session: ProximitySession<M>, message: M, role: TimelineEntryRole) => {
        session.entries.push({ message, role, sessionIndex: session.index, isCurrentSession: false });
        if (role === "message" && !NOTICE_TYPES.has(message.type ?? "")) {
            session.messages.push(message);
            session.lastMessage = message;
        }
    };

    for (const message of messages) {
        const marker = message.session;
        if (marker?.kind === "start") {
            if (open) {
                open.endedAt = message.date?.getTime();
                sessions.push(open);
            }
            index++;
            const id = marker.sessionId ?? `session-${index}`;
            open = {
                id,
                stayIds: [id],
                index,
                label: marker.label,
                participants: [],
                participantIds: [],
                isArea: marker.isArea ?? marker.participants.length === 0,
                startedAt: message.date?.getTime(),
                endedAt: undefined,
                entries: [],
                messages: [],
                lastMessage: undefined,
                unsentDraft: undefined,
                isLive: false,
            };
            addPeople(open, marker.participants, marker.participantIds ?? []);
            add(open, message, "start");
            continue;
        }
        if (marker?.kind === "end") {
            if (open) {
                add(open, message, "end");
                // Whoever was still there when you left counts too: they may have joined after the start.
                if (!open.isArea) addPeople(open, marker.participants, marker.participantIds ?? []);
                open.endedAt = message.date?.getTime();
                open.unsentDraft = marker.unsentDraft ?? drafts?.get(open.id);
                sessions.push(open);
                open = undefined;
            } else {
                add(loose, message, "end");
            }
            continue;
        }
        add(open ?? loose, message, "message");
    }
    if (open) {
        const startedRecently =
            currentSpaceJoinedAt !== undefined &&
            open.startedAt !== undefined &&
            open.startedAt >= currentSpaceJoinedAt - 1000;
        open.isLive = startedRecently;
        if (!open.isLive) open.unsentDraft = open.unsentDraft ?? drafts?.get(open.id);
        sessions.push(open);
    }
    const conversations = continueConversations(sessions, rules);
    for (const session of conversations) {
        for (const entry of session.entries) entry.isCurrentSession = session.isLive;
    }
    if (loose.entries.length > 0) conversations.unshift(loose);
    return conversations;
}

/** The session a stay belongs to: its own, or the conversation it carried on. */
export function sessionOfStay<M extends SessionTimelineMessage>(
    sessions: readonly ProximitySession<M>[],
    stayId: string
): ProximitySession<M> | undefined {
    return sessions.find((session) => session.id === stayId || session.stayIds.includes(stayId));
}

/** The live session, if any. */
export function liveSession<M extends SessionTimelineMessage>(
    sessions: readonly ProximitySession<M>[]
): ProximitySession<M> | undefined {
    return sessions.find((session) => session.isLive);
}

/**
 * The ended sessions worth a row in the chat list: those where someone actually wrote something.
 * The room messages count too, but only when there is no live session (they join the live one otherwise).
 */
export function listableSessions<M extends SessionTimelineMessage>(
    sessions: readonly ProximitySession<M>[]
): ProximitySession<M>[] {
    const hasLive = sessions.some((session) => session.isLive);
    return sessions.filter((session) => {
        if (session.isLive) return false;
        if (session.id === ROOM_MESSAGES_SESSION_ID) return !hasLive && session.messages.length > 0;
        return session.messages.length > 0 || session.unsentDraft !== undefined;
    });
}
