import { botIdFromChatId } from "../Chat/Bots/BotChatStatus";

export type ArtifactKind = "app" | "page" | "markdown" | "svg";

const KINDS: readonly ArtifactKind[] = ["app", "page", "markdown", "svg"];
const TITLE_MAX = 120;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** What a chat shows for one version of an artifact a bot made (live artifacts, game #1422). */
export interface ArtifactCard {
    id: string;
    version: number;
    title: string;
    /** Missing from a line of nearby chat that does not carry it. */
    kind: ArtifactKind | undefined;
    /** The bot that made it, when the chat says (a direct message does; nearby chat shows the sender instead). */
    maker: string | undefined;
}

/** The line nearby chat carries a card in: `::artifact:<id>:<version>[:<kind>]::<title>`. */
const MARKER = new RegExp(`^::artifact:(${UUID}):(\\d{1,6})(?::(app|page|markdown|svg))?::(.{1,${TITLE_MAX}})$`, "i");

/**
 * The card a line of nearby chat stands for, or undefined when it is anything else. Only a bot can make a card: a
 * person typing the same line gets the line.
 */
export function readArtifactLine(body: string | null | undefined, senderIsBot: boolean): ArtifactCard | undefined {
    if (!senderIsBot || !body) return undefined;
    const found = MARKER.exec(body.trim());
    if (!found) return undefined;
    const version = Number(found[2]);
    if (version < 1) return undefined;
    const title = found[4].trim();
    if (!title) return undefined;
    return {
        id: found[1].toLowerCase(),
        version,
        title,
        kind: found[3]?.toLowerCase() as ArtifactKind | undefined,
        maker: undefined,
    };
}

/** The card a bot's direct message carries (its `universe.artifact` field), or undefined when it has none. */
export function readArtifactField(
    sender: string | null | undefined,
    content: Record<string, unknown>
): ArtifactCard | undefined {
    if (!botIdFromChatId(sender) || content.msgtype !== "m.text") return undefined;
    const value = content["universe.artifact"];
    if (!value || typeof value !== "object") return undefined;
    const { id, version, title, kind, maker } = value as Record<string, unknown>;
    if (typeof id !== "string" || !new RegExp(`^${UUID}$`, "i").test(id)) return undefined;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return undefined;
    if (typeof title !== "string" || !title.trim()) return undefined;
    return {
        id: id.toLowerCase(),
        version,
        title: title.trim().slice(0, TITLE_MAX),
        kind:
            typeof kind === "string" && (KINDS as readonly string[]).includes(kind)
                ? (kind as ArtifactKind)
                : undefined,
        maker: typeof maker === "string" && maker.trim() ? maker.trim().slice(0, 100) : undefined,
    };
}
