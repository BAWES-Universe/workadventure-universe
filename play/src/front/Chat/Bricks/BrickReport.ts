import { botIdFromChatId } from "../Bots/BotChatStatus";

/**
 * A note a Brick sent to the Universe team (mock "Brick reports inbox"), as it rides on the words of the Brick's answer. The chat shows
 * "Sent to the Universe team" under the answer; "See what was sent" opens the note as Orbit kept it (product-only: its kind, area and a
 * title built from fixed words), the person's own words when they asked to tell the team something (not sent until they press Send), and
 * Take it back for 24 hours with the key the message carries. Nothing in here talks to a server, so every rule can be unit tested.
 */
export const BRICK_REPORTS_KEY = "universe.brick_reports";

export const REPORT_KINDS = ["problem", "cant_do", "friction", "idea"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const REPORT_AREAS = [
    "apps",
    "computer",
    "pages",
    "chat",
    "voice",
    "map",
    "memory",
    "files",
    "credit",
    "other",
] as const;
export type ReportArea = (typeof REPORT_AREAS)[number];

/** How long the chat can take a note back. */
export const TAKE_BACK_MS = 24 * 60 * 60 * 1000;

export interface BrickReport {
    id: string;
    key: string;
    kind: ReportKind;
    area: ReportArea;
    /** Built by Orbit from fixed words ("Signed out: Gmail App"), never from the chat. */
    title: string;
    /** The Brick tried the step again before sending. */
    retried: boolean;
    /** The person's own words, exactly as Orbit cleaned them, waiting for them to press Send; empty when they asked to say nothing. */
    wordsDraft: string;
    /** When it was sent (ms); 0 when the message did not say. */
    sentAt: number;
}

const TITLE_MAX = 80;
const TEXT_MAX = 280;
const REPORTS_MAX = 4;

const text = (value: unknown, max: number): string =>
    typeof value === "string" ? Array.from(value.replace(/\s+/g, " ").trim()).slice(0, max).join("") : "";

const oneOf = <T extends string>(value: unknown, list: readonly T[], fallback: T): T =>
    (list as readonly string[]).includes(value as string) ? (value as T) : fallback;

/** The notes a Brick's answer says it sent; none for anyone else's message or anything malformed. */
export function readBrickReports(sender: string | null | undefined, content: Record<string, unknown>): BrickReport[] {
    const list = content[BRICK_REPORTS_KEY];
    if (botIdFromChatId(sender) === undefined || content.msgtype !== "m.text" || !Array.isArray(list)) return [];
    const reports: BrickReport[] = [];
    for (const one of list.slice(0, REPORTS_MAX)) {
        if (!one || typeof one !== "object") continue;
        const { id, key, kind, area, title, retried, wordsDraft, sentAt } = one as Record<string, unknown>;
        if (typeof id !== "string" || !id || typeof key !== "string" || !key || !text(title, TITLE_MAX)) continue;
        if (reports.some((other) => other.id === id)) continue;
        reports.push({
            id: id.slice(0, 100),
            key: key.slice(0, 100),
            kind: oneOf(kind, REPORT_KINDS, "problem"),
            area: oneOf(area, REPORT_AREAS, "other"),
            title: text(title, TITLE_MAX),
            retried: retried === true,
            wordsDraft: text(wordsDraft, TEXT_MAX),
            sentAt: typeof sentAt === "number" && Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
        });
    }
    return reports;
}

/**
 * Whether the note can still be taken back: within 24 hours of sending, by the message's own time when the note does not say (the
 * server has the last word either way).
 */
export function canTakeBack(report: BrickReport, messageAt: number | null, now: number): boolean {
    const sentAt = report.sentAt || messageAt || 0;
    return sentAt > 0 && now - sentAt < TAKE_BACK_MS;
}
