import type { BotAiOptions } from "./types";

/**
 * What the bot page's "Runs on" shows (#374), decided in one place: which cards, in which order, which one is picked,
 * which can be tapped. Pure, so every case is a test. The words are the page's (i18n); this only says what is what.
 */

export const UNIVERSE_AI_REF = "universe-ai";
const OWN_KEY_PREFIX = "key-";

/** A ref is a person's own key when Orbit made it one (`key-…`); anything else is a server provider or Universe AI. */
export const isOwnKeyRef = (ref: string | null | undefined): boolean => !!ref && ref.startsWith(OWN_KEY_PREFIX);

export type RunsOnCard =
    | { kind: "universe-ai"; id: typeof UNIVERSE_AI_REF; picked: boolean; selectable: boolean; available: boolean }
    /** One of the viewer's own keys, lent to this bot's universe. */
    | {
          kind: "mine";
          id: string;
          title: string;
          picked: boolean;
          selectable: boolean;
          group: "own-computer" | "hosted" | null;
          universe: string;
          status: "working" | "down";
          ifDown: "universe-ai" | "stop";
          logo: string | null;
          plainIcon: "plug" | "chip" | null;
      }
    /** Someone else's key the bot is on now: shown as it is, never offered, only Universe AI can replace it. */
    | {
          kind: "theirs";
          id: string;
          title: string;
          owner: string | null;
          picked: true;
          selectable: false;
          status: "working" | "down";
          ifDown: "universe-ai" | "stop";
          logo: string | null;
          plainIcon: "plug" | "chip" | null;
      }
    /** A server provider the bot is pinned to (a super admin did that): shown as it is. */
    | { kind: "pinned"; id: string; title: string; picked: true; selectable: false }
    /** A personal key the bot points at that Orbit no longer knows (removed): said so, never shown as a raw id. Only Universe AI can replace it. */
    | { kind: "gone"; id: string; picked: true; selectable: false };

/** The cards for one bot, in the order the mock shows: what it is on now (when that isn't Universe AI or one of my keys), Universe AI, then my keys. */
export function runsOnCards(
    options: BotAiOptions,
    ref: string | null | undefined,
    providerNames: ReadonlyMap<string, string> = new Map()
): RunsOnCard[] {
    const current = ref ?? options.current ?? null;
    const cards: RunsOnCard[] = [];
    const mineIds = new Set(options.keys.map((key) => key.id));

    if (current && current !== UNIVERSE_AI_REF && !mineIds.has(current)) {
        if (isOwnKeyRef(current) && options.currentKey && options.currentKey.id === current) {
            cards.push(
                options.currentKey.mine
                    ? {
                          // My own key, but no longer lent here: shown as it is; Universe AI is the way off it
                          kind: "theirs",
                          id: current,
                          title: options.currentKey.name,
                          owner: null,
                          picked: true,
                          selectable: false,
                          status: options.currentKey.status,
                          ifDown: options.currentKey.ifDown,
                          logo: options.currentKey.logo ?? null,
                          plainIcon: options.currentKey.plainIcon ?? null,
                      }
                    : {
                          kind: "theirs",
                          id: current,
                          title: options.currentKey.name,
                          owner: options.currentKey.ownerName,
                          picked: true,
                          selectable: false,
                          status: options.currentKey.status,
                          ifDown: options.currentKey.ifDown,
                          logo: options.currentKey.logo ?? null,
                          plainIcon: options.currentKey.plainIcon ?? null,
                      }
            );
        } else if (isOwnKeyRef(current)) {
            cards.push({ kind: "gone", id: current, picked: true, selectable: false });
        } else {
            const name =
                providerNames.get(current.toLowerCase()) ??
                options.providers?.find((provider) => provider.id.toLowerCase() === current.toLowerCase())?.name ??
                current;
            cards.push({ kind: "pinned", id: current, title: name, picked: true, selectable: false });
        }
    }

    cards.push({
        kind: "universe-ai",
        id: UNIVERSE_AI_REF,
        picked: current === UNIVERSE_AI_REF,
        selectable: options.universeAi.available,
        available: options.universeAi.available,
    });

    for (const key of options.keys) {
        cards.push({
            kind: "mine",
            id: key.id,
            title: key.name,
            picked: current === key.id,
            selectable: true,
            group: key.group,
            universe: key.universeName,
            status: key.status,
            ifDown: key.ifDown,
            logo: key.logo ?? null,
            plainIcon: key.plainIcon ?? null,
        });
    }
    return cards;
}

/**
 * The viewer's own keys that are not lent to this bot's universe (#1375). Only lent keys show under "Runs on", so the page
 * names these and says how to lend them. Anyone who manages a bot may put it on their own key (#1579), so this is for
 * everyone, not only the maker. Empty when their keys can't be loaded.
 */
export function unlentKeyNames(
    options: BotAiOptions,
    myKeys: ReadonlyArray<{ id: string; name: string }> | null
): string[] {
    if (!myKeys) return [];
    const lent = new Set(options.keys.map((key) => key.id));
    return myKeys.filter((key) => !lent.has(key.id)).map((key) => key.name);
}

/** What a key's card draws before its name. */
export type KeyIcon = { kind: "logo"; url: string } | { kind: "plug" } | { kind: "chip" } | { kind: "key" };

/**
 * The logo file's address. The name comes from Orbit and ends up in a style, so only a plain file name is accepted;
 * anything else draws no logo.
 */
export function aiLogoUrl(logo: string | null | undefined): string | null {
    return logo && /^[a-z0-9-]+$/.test(logo) ? `/static/ai-providers/${logo}.svg` : null;
}

/**
 * The icon of a "Runs on" card: the provider's logo, a plug for "any server", a chip for a key whose kind is unknown,
 * and the plain key where Orbit doesn't say (an older Orbit). Universe AI keeps its own sparkles, so it has none here.
 */
export function cardIcon(card: RunsOnCard): KeyIcon | null {
    if (card.kind === "universe-ai") return null;
    if (card.kind !== "mine" && card.kind !== "theirs") return { kind: "key" };
    const url = aiLogoUrl(card.logo);
    if (url) return { kind: "logo", url };
    if (card.plainIcon === "plug") return { kind: "plug" };
    if (card.plainIcon === "chip") return { kind: "chip" };
    return { kind: "key" };
}

/** The one line under "Mind" while it is closed: Universe AI, the key's name, or the provider it is pinned to. */
export function mindBriefName(
    options: BotAiOptions,
    ref: string | null | undefined,
    providerNames: ReadonlyMap<string, string> = new Map()
):
    | { kind: "none" }
    | { kind: "universe-ai" }
    | { kind: "key"; name: string }
    | { kind: "gone" }
    | { kind: "provider"; ref: string; name: string | null } {
    const current = ref ?? options.current ?? null;
    if (!current) return { kind: "none" };
    if (current === UNIVERSE_AI_REF) return { kind: "universe-ai" };
    if (isOwnKeyRef(current)) {
        const key = options.keys.find((entry) => entry.id === current);
        const name = key?.name ?? (options.currentKey?.id === current ? options.currentKey.name : null);
        return name ? { kind: "key", name } : { kind: "gone" };
    }
    const name =
        providerNames.get(current.toLowerCase()) ??
        options.providers?.find((provider) => provider.id.toLowerCase() === current.toLowerCase())?.name ??
        null;
    return { kind: "provider", ref: current, name };
}

/** Who may change what a bot runs on: its maker may pick their own lent keys; anyone who manages bots may move it to Universe AI. */
export function canPick(options: BotAiOptions, card: RunsOnCard): boolean {
    return card.selectable && !card.picked && (card.kind === "universe-ai" || card.kind === "mine");
}

/** What a new bot starts on: Universe AI when Orbit says it is ready, otherwise nothing is decided here (the page keeps its old choice). */
export function newBotRef(options: BotAiOptions | null): string | undefined {
    return options?.universeAi.available ? UNIVERSE_AI_REF : undefined;
}
