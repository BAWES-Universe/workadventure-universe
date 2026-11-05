import type { ComponentType } from "svelte";
import type { SpaceUserExtended } from "../../Space/SpaceInterface";
import type { WokaMenuAction } from "../../Stores/WokaMenuStore";

/** One button on a person's card: a tile in the grid, or a row under More (#1790). */
export interface CardAction {
    id: string;
    label: string;
    icon?: ComponentType;
    /** An image address, for the actions that bring their own icon. */
    iconSrc?: string;
    testId?: string;
    /** "go": the one main step on this card (gradient). "danger": Block, Remove friend (under More only). */
    tone?: "go" | "danger";
}

export interface CardStatus {
    label: string;
    /** The dot's colour; none for offline or yourself. */
    colour?: string;
}

export interface CardRole {
    name: string;
    color: string;
}

export type CardRelation = "friend" | "requestSent" | "requestReceived";

/**
 * How many tiles go in a row. Up to four share one row; five or six split evenly (3 + 2, 3 + 3), so the last row never
 * holds a lone button; more go four to a row, or three when four would leave one alone (nine: 3 + 3 + 3).
 */
export function gridColumns(count: number): number {
    if (count <= 4) return Math.max(count, 1);
    if (count <= 6) return 3;
    return count % 4 === 1 ? 3 : 4;
}

/** The tiles in each row, for the same split as gridColumns (the last row holds what is left). */
export function gridRows(count: number): number[] {
    if (count <= 0) return [];
    const columns = gridColumns(count);
    const rows: number[] = [];
    for (let left = count; left > 0; left -= columns) rows.push(Math.min(columns, left));
    return rows;
}

/** The look a menu action asks for through its style: the one main step is "is-primary", a harsh one is red. */
export function toneOf(style: string | undefined): CardAction["tone"] {
    if (style?.includes("is-primary")) return "go";
    if (style?.includes("text-red-500")) return "danger";
    return undefined;
}

export function toCardAction(action: WokaMenuAction): CardAction {
    const icon = action.actionIcon;
    return {
        id: action.uuid ?? action.actionName,
        label: action.actionName,
        icon: typeof icon === "function" ? icon : undefined,
        iconSrc: typeof icon === "string" ? icon : undefined,
        testId: action.testId,
        tone: toneOf(action.style),
    };
}

/**
 * The card's actions from the store's, highest priority first: the ones beside each other (tiles) and the ones under
 * More. A bot's card has no More: nobody blocks or reports a bot, and nothing is kept back for a list it doesn't have.
 */
export function splitCardActions(
    actions: readonly WokaMenuAction[],
    isBot: boolean
): { main: WokaMenuAction[]; more: WokaMenuAction[] } {
    const sorted = [...actions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const main = sorted.filter((action) => !action.overflow);
    return { main, more: isBot ? [] : sorted.filter((action) => action.overflow) };
}

/**
 * The person a card is about, among the world's users. One account can be in the world several times (other tabs and
 * devices): the session whose avatar the card shows is the one with this user id (space user ids end with it).
 */
export function findWorldUser(
    users: ReadonlyMap<string, SpaceUserExtended> | undefined,
    userUuid: string,
    userId: number
): SpaceUserExtended | undefined {
    if (!users || !userUuid) return undefined;
    let sameAccount: SpaceUserExtended | undefined;
    for (const user of users.values()) {
        if (user.uuid !== userUuid) continue;
        if (userId !== -1 && user.spaceUserId.endsWith(`_${userId}`)) return user;
        sameAccount ??= user;
    }
    return sameAccount;
}
