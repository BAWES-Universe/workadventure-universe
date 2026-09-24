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
}

export interface SessionTimelineMessage {
    id: string;
    date: Date | null;
    session?: ProximitySessionMarker;
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
