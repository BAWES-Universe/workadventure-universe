/**
 * Meet is an exchange, not a sent message: within one bubble session, the player says something and someone else
 * says something. Leaving the bubble or a reconnect starts a new session; nothing pairs across sessions.
 */
export type MeetProgress = "idle" | "sent" | "exchanged";

/** The fields of a proximity chat message the exchange looks at. */
export interface MeetMessage {
    isMyMessage: boolean;
    type: string;
    /** Set on local join/leave markers. */
    session?: unknown;
    notSent?: boolean;
    sender: { uuid?: string };
}

// ProximityChatRoom's placeholder for a sender it cannot resolve (also used by scripted local messages).
const UNKNOWN_SENDER_UUID = "0";

const OTHER_SIDE_TYPES = new Set(["proximity", "image", "file", "audio", "video", "gallery"]);

export type MeetSide = "mine" | "theirs" | "ignore";

/**
 * Which side of the exchange a message counts for. A reply from another tab of the same account is not a reply.
 */
export function classifyMeetMessage(message: MeetMessage, localUuid: string | undefined): MeetSide {
    if (message.session !== undefined || message.notSent) return "ignore";
    if (message.isMyMessage) return message.type === "proximity" ? "mine" : "ignore";
    const uuid = message.sender.uuid;
    if (!uuid || uuid === UNKNOWN_SENDER_UUID) return "ignore";
    if (localUuid && uuid === localUuid) return "ignore";
    return OTHER_SIDE_TYPES.has(message.type) ? "theirs" : "ignore";
}

export class MeetExchange {
    private sessionId: string | undefined;
    private sent = false;
    private received = false;

    get progress(): MeetProgress {
        if (this.sent && this.received) return "exchanged";
        return this.sent ? "sent" : "idle";
    }

    get currentSession(): string | undefined {
        return this.sessionId;
    }

    /** The bubble session changed (joined, left, or a new map): what was said before no longer counts. */
    enterSession(sessionId: string | undefined): void {
        if (sessionId === this.sessionId) return;
        this.sessionId = sessionId;
        this.sent = false;
        this.received = false;
    }

    reset(): void {
        this.enterSession(undefined);
    }

    /**
     * Records one side for the given session. Returns true the moment both sides are in. Outside a session (alone),
     * nothing counts.
     */
    record(side: "mine" | "theirs", sessionId: string | undefined): boolean {
        if (sessionId === undefined || sessionId !== this.sessionId) return false;
        const before = this.progress;
        if (side === "mine") this.sent = true;
        else this.received = true;
        return before !== "exchanged" && this.progress === "exchanged";
    }
}
