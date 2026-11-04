/**
 * What a bot may do with each tool of an MCP server (game #1655, Orbit #738). Tools sit under four headings by what
 * they do; each heading has one choice per server (Right away, Asks first or Off); a tool is only a suggestion until
 * someone who manages the bot confirms it. Orbit keeps all of it; this reads Orbit's answers for the bot page's Tools
 * screens and never decides anything itself.
 */
export const HEADINGS = ["looksUp", "makesNew", "changesThings", "deletesOrSends"] as const;
export type Heading = (typeof HEADINGS)[number];

export const SETTINGS = ["rightAway", "asksFirst", "off"] as const;
export type Setting = (typeof SETTINGS)[number];

export type SuggestionSource = "server" | "description" | "builtIn";
/** Not checked yet: an old server that works as it did. Not confirmed yet: tools wait. Confirmed: every tool is. */
export type ToolsState = "notCheckedYet" | "notConfirmedYet" | "confirmed";

export interface ServerTool {
    id: string;
    name: string;
    title: string | null;
    description: string | null;
    suggestedHeading: Heading | null;
    suggestionSource: SuggestionSource | null;
    /** What a person chose or accepted from the suggestion; null until then */
    heading: Heading | null;
    state: "confirmed" | "notConfirmedYet";
    /** Names only: Orbit never sends people's emails */
    confirmedBy: string | null;
    movedBy: string | null;
}

export interface ServerTools {
    serverId: string;
    state: ToolsState;
    /** Goes up with every change, so Confirm all only confirms the list the person saw */
    policyRevision: number;
    settings: Record<Heading, Setting>;
    tools: ServerTool[];
    /** The server has more tools than Orbit keeps, so `tools` is only its first ones (Orbit #801) */
    truncated: boolean;
    /** How many tools the server has, when the bot server read them all; null when it only knew there were more */
    totalSeen: number | null;
}

export interface BotToolSettings {
    /** Asks before making more than this many things in one request; null is no limit */
    askBeforeMaking: number | null;
    askWhichWay: "rarely" | "beforeBiggerJobs" | "never";
    cardWaitMinutes: number;
    /** "Allow more of the same in this chat" ends after this long without the person's messages (Orbit #803) */
    allowMoreIdleMinutes: number;
    /** ...and after this long at most, even while they keep chatting */
    allowMoreMaxMinutes: number;
}

export const ASK_BEFORE_MAKING_CHOICES: ReadonlyArray<number | null> = [3, 5, 10, null];
export const ASK_WHICH_WAY_CHOICES: ReadonlyArray<BotToolSettings["askWhichWay"]> = [
    "rarely",
    "beforeBiggerJobs",
    "never",
];
export const CARD_WAIT_CHOICES: readonly number[] = [5, 10, 30];
export const ALLOW_MORE_IDLE_CHOICES: readonly number[] = [30, 60, 120];
export const ALLOW_MORE_MAX_CHOICES: readonly number[] = [240, 480, 1440];
export const DEFAULT_ALLOW_MORE_IDLE_MINUTES = 60;
export const DEFAULT_ALLOW_MORE_MAX_MINUTES = 480;

/** One remembered approval that is still alive: someone was allowed more of the same in a chat with this bot (Orbit #803, #805) */
export interface AllowedMore {
    id: string;
    /** Their name, or null when Orbit does not know them */
    name: string | null;
    isGuest: boolean;
    /** The tool's own title, else its name */
    tool: string;
    /** What stays as approved, in words ("WEB"): empty when nothing is worth saying */
    fixed: string;
}

/** The screens the Tools group opens in place of the bot page. A tool with no heading yet sits under "unsorted". */
export type ToolsScreen =
    | { kind: "server"; serverId: string }
    | { kind: "heading"; serverId: string; heading: Heading | "unsorted" }
    | { kind: "approvals" };

const DEFAULT_SETTINGS: Record<Heading, Setting> = {
    looksUp: "rightAway",
    makesNew: "rightAway",
    changesThings: "asksFirst",
    deletesOrSends: "asksFirst",
};

const obj = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const heading = (value: unknown): Heading | null =>
    typeof value === "string" && (HEADINGS as readonly string[]).includes(value) ? (value as Heading) : null;
const setting = (value: unknown, fallback: Setting): Setting =>
    typeof value === "string" && (SETTINGS as readonly string[]).includes(value) ? (value as Setting) : fallback;

function readTool(raw: unknown): ServerTool | undefined {
    const o = obj(raw);
    if (typeof o.id !== "string" || typeof o.name !== "string") return undefined;
    const source = str(o.suggestionSource);
    const suggested = heading(o.suggestedHeading);
    return {
        id: o.id,
        name: o.name,
        title: str(o.title),
        description: str(o.description),
        suggestedHeading: suggested,
        suggestionSource:
            suggested && (source === "server" || source === "description" || source === "builtIn") ? source : null,
        heading: heading(o.heading),
        state: o.state === "confirmed" ? "confirmed" : "notConfirmedYet",
        confirmedBy: str(obj(o.confirmedBy).name),
        movedBy: str(obj(o.movedBy).name),
    };
}

/** Orbit's answer as the page uses it. Anything missing reads as nothing, never as a broken page. */
export function readServerTools(raw: unknown): ServerTools {
    const o = obj(raw);
    if (typeof o.serverId !== "string" || !Array.isArray(o.tools)) {
        throw new Error("Orbit answered with something the game does not understand");
    }
    const settings = obj(o.settings);
    const tools = o.tools.map(readTool).filter((tool): tool is ServerTool => tool !== undefined);
    return {
        serverId: o.serverId,
        state: o.state === "notCheckedYet" || o.state === "confirmed" ? o.state : "notConfirmedYet",
        policyRevision: typeof o.policyRevision === "number" ? o.policyRevision : 0,
        settings: {
            looksUp: setting(settings.looksUp, DEFAULT_SETTINGS.looksUp),
            makesNew: setting(settings.makesNew, DEFAULT_SETTINGS.makesNew),
            changesThings: setting(settings.changesThings, DEFAULT_SETTINGS.changesThings),
            deletesOrSends: setting(settings.deletesOrSends, DEFAULT_SETTINGS.deletesOrSends),
        },
        tools,
        // An older Orbit sends neither field: the list reads as whole
        truncated: o.truncated === true,
        // A count that is not more than what is listed cannot be right, so it reads as not known
        totalSeen:
            o.truncated === true && Number.isInteger(o.totalSeen) && (o.totalSeen as number) > tools.length
                ? (o.totalSeen as number)
                : null,
    };
}

export function readBotToolSettings(raw: unknown): BotToolSettings {
    const o = obj(raw);
    const wait = typeof o.cardWaitMinutes === "number" ? o.cardWaitMinutes : 10;
    const way = ASK_WHICH_WAY_CHOICES.find((choice) => choice === o.askWhichWay) ?? "rarely";
    return {
        askBeforeMaking:
            o.askBeforeMaking === null ? null : typeof o.askBeforeMaking === "number" ? o.askBeforeMaking : 5,
        askWhichWay: way,
        cardWaitMinutes: wait,
        allowMoreIdleMinutes:
            typeof o.allowMoreIdleMinutes === "number" ? o.allowMoreIdleMinutes : DEFAULT_ALLOW_MORE_IDLE_MINUTES,
        allowMoreMaxMinutes:
            typeof o.allowMoreMaxMinutes === "number" ? o.allowMoreMaxMinutes : DEFAULT_ALLOW_MORE_MAX_MINUTES,
    };
}

/** What each remembered approval stays fixed on, in words: the values that are places or choices, never the text of anything */
function fixedWords(scope: unknown): string {
    const fixed = obj(obj(scope).fixed);
    const words = Object.values(fixed)
        .filter((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
        .map(String)
        .filter((word) => word.trim() !== "");
    const line = words.join(" · ");
    return line.length > 40 ? `${line.slice(0, 39)}…` : line;
}

/** Orbit's list of who is allowed more right now. A row that does not make sense is left out, never a broken page. */
export function readAllowedMore(raw: unknown): AllowedMore[] {
    const o = obj(raw);
    if (!Array.isArray(o.grants)) return [];
    const rows: AllowedMore[] = [];
    for (const item of o.grants) {
        const g = obj(item);
        if (typeof g.id !== "string" || typeof g.toolName !== "string") continue;
        const person = obj(g.person);
        rows.push({
            id: g.id,
            name: str(person.name)?.trim() || null,
            isGuest: person.isGuest === true,
            tool: str(g.toolTitle)?.trim() || g.toolName,
            fixed: fixedWords(g.scope),
        });
    }
    return rows;
}

/** Where a tool sits: what a person chose, or else what was suggested. Null when neither. */
export function headingOf(tool: ServerTool): Heading | null {
    return tool.heading ?? tool.suggestedHeading;
}

/** A tool's name as its own title gives it, else its name */
export function toolLabel(tool: ServerTool): string {
    return tool.title?.trim() || tool.name;
}

export function toolsUnder(tools: readonly ServerTool[], under: Heading | "unsorted"): ServerTool[] {
    return tools.filter((tool) => (headingOf(tool) ?? "unsorted") === under);
}

/** Tools still waiting for someone to confirm them */
export function toCheck(tools: readonly ServerTool[]): number {
    return tools.filter((tool) => tool.state !== "confirmed").length;
}

/** The first few tool names for the quiet line under a heading's count, and how many more there are */
export function briefNames(tools: readonly ServerTool[], shown = 3): { names: string[]; more: number } {
    return { names: tools.slice(0, shown).map(toolLabel), more: Math.max(0, tools.length - shown) };
}

/** The tools a search finds, by what a tool is called or says it does */
export function searchTools(tools: readonly ServerTool[], query: string): ServerTool[] {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return [];
    return tools.filter((tool) =>
        [tool.title ?? "", tool.name, tool.description ?? ""].some((text) => text.toLocaleLowerCase().includes(q))
    );
}

/** A heading to give as the example of where a tool can be moved, never the one it is under */
export function exampleHeading(current: Heading | "unsorted"): Heading {
    return current === "deletesOrSends" ? "changesThings" : "deletesOrSends";
}

/** The headings with tools in them, in the order the page shows them */
export function usedHeadings(tools: readonly ServerTool[]): Array<Heading | "unsorted"> {
    const used: Array<Heading | "unsorted"> = HEADINGS.filter((one) => toolsUnder(tools, one).length > 0);
    if (toolsUnder(tools, "unsorted").length > 0) used.push("unsorted");
    return used;
}
