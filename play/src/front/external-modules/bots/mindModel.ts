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
        });
    }
    return cards;
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
    return (
        card.selectable &&
        !card.picked &&
        (card.kind === "universe-ai" || (card.kind === "mine" && options.viewerIsMaker))
    );
}

/** What a new bot starts on: Universe AI when Orbit says it is ready, otherwise nothing is decided here (the page keeps its old choice). */
export function newBotRef(options: BotAiOptions | null): string | undefined {
    return options?.universeAi.available ? UNIVERSE_AI_REF : undefined;
}
