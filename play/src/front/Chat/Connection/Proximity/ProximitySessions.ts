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

export type TimelineEntryRole = "start" | "end" | "message";

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

export interface ProximitySession<M extends SessionTimelineMessage = SessionTimelineMessage> {
    /** The stay's id, or ROOM_MESSAGES_SESSION_ID for messages outside any stay. */
    id: string;
    /** 1, 2, … in timeline order; 0 for the room messages. */
    index: number;
    /** "Sara & Omar", or the area's name. Empty for the room messages. */
    label: string;
    participants: string[];
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
 * Splits the timeline into stays. Each start marker opens a session that runs until its end marker;
 * messages before the first start or between an end and the next start go to the room messages session.
 * A session with no end marker is live only while a space is joined: an unfinished session of a carried
 * timeline (no space joined now) counts as ended.
 */
export function buildProximitySessions<M extends SessionTimelineMessage>(
    messages: readonly M[],
    currentSpaceJoinedAt: number | undefined
): ProximitySession<M>[] {
    const sessions: ProximitySession<M>[] = [];
    const loose: ProximitySession<M> = {
        id: ROOM_MESSAGES_SESSION_ID,
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
            open = {
                id: marker.sessionId ?? `session-${index}`,
                index,
                label: marker.label,
                participants: marker.participants,
                participantIds: marker.participantIds ?? [],
                isArea: marker.isArea ?? marker.participants.length === 0,
                startedAt: message.date?.getTime(),
                endedAt: undefined,
                entries: [],
                messages: [],
                lastMessage: undefined,
                unsentDraft: undefined,
                isLive: false,
            };
            add(open, message, "start");
            continue;
        }
        if (marker?.kind === "end") {
            if (open) {
                add(open, message, "end");
                open.endedAt = message.date?.getTime();
                open.unsentDraft = marker.unsentDraft;
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
        sessions.push(open);
    }
    for (const session of sessions) {
        for (const entry of session.entries) entry.isCurrentSession = session.isLive;
    }
    if (loose.entries.length > 0) sessions.unshift(loose);
    return sessions;
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
