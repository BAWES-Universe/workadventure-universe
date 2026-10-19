import type { BotAiOptions, BotData, VisionPick } from "./types";
import { UNIVERSE_AI_REF } from "./mindModel";
import { resolveVisionSupport } from "./visionModels";

/**
 * What the bot page's Vision row shows (#374): where the bot's images go, decided in one place so every case is a test.
 * The bot's own model still writes every reply; this only says what looks at the images people send.
 *
 * The same rule runs in Orbit when the bot server asks how the bot talks to its AI (lib/bot-vision.ts `autoVision`), so what
 * this page shows picked is what really happens: a model that sees looks at images itself; one that can't, on a person's own
 * key, uses a Vision model on that same key when the provider has one; otherwise Universe AI looks at them.
 */

/** What a bot's images go to now: what is saved in its behavior config, or null when the owner picked nothing. */
export function readVisionPick(bot: Pick<BotData, "behaviorConfig">): VisionPick | null {
    const raw = bot.behaviorConfig?.vision;
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;
    if (value.choice === "this") return { choice: "this" };
    if (value.choice === "universe-ai") return { choice: "universe-ai" };
    if (
        value.choice === "another" &&
        typeof value.keyId === "string" &&
        value.keyId &&
        typeof value.model === "string" &&
        value.model
    ) {
        return { choice: "another", keyId: value.keyId, model: value.model };
    }
    return null;
}

/** The AI the bot's own model comes from: Universe AI, or one of its keys. */
export interface VisionMain {
    /** Universe AI, or the key's name. */
    name: string;
    model: string | null;
    sees: boolean;
    /** Set when the bot runs on a person's own key. */
    keyId: string | null;
    group: "own-computer" | "hosted" | null;
    /** Models with Vision the same key could use for images, other than the one the bot runs. */
    sameKeyModels: string[];
}

/** The main AI for the ref the page has now (not yet saved, maybe). Null when the row has nothing to say: a pinned provider, no AI, or an Orbit that doesn't tell. */
export function visionMain(options: BotAiOptions, ref: string | null | undefined): VisionMain | null {
    const current = ref ?? options.current ?? null;
    if (!current) return null;
    if (current === UNIVERSE_AI_REF) {
        const universe = options.universeAi;
        if (!universe.available || universe.model === undefined) return null;
        return {
            name: "Universe AI",
            model: universe.model,
            sees: resolveVisionSupport(universe.model ?? "", universe.supportsVision),
            keyId: null,
            group: null,
            sameKeyModels: [],
        };
    }
    const key = options.keys.find((entry) => entry.id === current);
    const found =
        key && key.model !== undefined
            ? {
                  name: key.name,
                  model: key.model,
                  supportsVision: key.supportsVision,
                  group: key.group,
                  visionModels: key.visionModels,
              }
            : options.currentKey && options.currentKey.id === current && options.currentKey.model !== undefined
            ? {
                  name: options.currentKey.name,
                  model: options.currentKey.model,
                  supportsVision: options.currentKey.supportsVision,
                  group: options.currentKey.group ?? null,
                  visionModels: options.currentKey.visionModels,
              }
            : null;
    if (!found) return null;
    return {
        name: found.name,
        model: found.model ?? null,
        sees: resolveVisionSupport(found.model ?? "", found.supportsVision),
        keyId: current,
        group: found.group,
        sameKeyModels: (found.visionModels ?? []).filter((model) => model !== found.model),
    };
}

/** A model with Vision on one of the viewer's keys that "Another model" can use. */
export interface VisionCandidate {
    keyId: string;
    keyName: string;
    model: string;
    /** On the key the bot runs on, so the images stay there. */
    sameKey: boolean;
}

/** Only the bot's maker can use their keys; a key that is Down isn't offered; the model the bot runs on isn't "another" model. The same key comes first. */
export function visionCandidates(options: BotAiOptions, main: VisionMain): VisionCandidate[] {
    if (!options.viewerIsMaker) return [];
    const list: VisionCandidate[] = [];
    for (const key of options.keys) {
        if (key.status === "down") continue;
        for (const model of key.visionModels ?? []) {
            if (key.id === main.keyId && model === main.model) continue;
            list.push({ keyId: key.id, keyName: key.name, model, sameKey: key.id === main.keyId });
        }
    }
    return list.sort((a, b) => Number(b.sameKey) - Number(a.sameKey));
}

export type VisionEffective =
    | { choice: "this" }
    | { choice: "universe-ai" }
    | { choice: "another"; keyId: string; keyName: string; model: string; sameKey: boolean };

export interface VisionState {
    main: VisionMain;
    /** What happens to images now, and so what the page shows picked. */
    effective: VisionEffective;
    /** The owner picked it (false: this is the default, shown the same way, and it stays theirs to change). */
    picked: boolean;
    /** The key picked for images can't be used now, so nobody reads the images until the owner picks again. */
    problem: boolean;
    candidates: VisionCandidate[];
}

/** Null when there is nothing to show: no Vision facts from Orbit (an older one), or the bot isn't on Universe AI or one of its keys. */
export function visionState(
    options: BotAiOptions,
    ref: string | null | undefined,
    bot: Pick<BotData, "behaviorConfig">
): VisionState | null {
    if (!options.vision) return null;
    const main = visionMain(options, ref);
    if (!main) return null;
    const candidates = visionCandidates(options, main);
    const pick = readVisionPick(bot);

    if (pick && pick.choice !== "another") {
        return { main, effective: pick, picked: true, problem: false, candidates };
    }
    if (pick) {
        const offered = candidates.find((entry) => entry.keyId === pick.keyId && entry.model === pick.model);
        if (offered) {
            return {
                main,
                effective: {
                    choice: "another",
                    keyId: offered.keyId,
                    keyName: offered.keyName,
                    model: offered.model,
                    sameKey: offered.sameKey,
                },
                picked: true,
                problem: false,
                candidates,
            };
        }
        // Saved earlier: Orbit says whose key it was and whether it can still look at images (a pick made on this page is always offered)
        const saved = options.vision.saved;
        const savedKey = options.vision.savedKey;
        if (
            saved?.choice === "another" &&
            saved.keyId === pick.keyId &&
            saved.model === pick.model &&
            savedKey &&
            !savedKey.problem
        ) {
            return {
                main,
                effective: {
                    choice: "another",
                    keyId: pick.keyId,
                    keyName: savedKey.name,
                    model: pick.model,
                    sameKey: pick.keyId === main.keyId,
                },
                picked: true,
                problem: false,
                candidates,
            };
        }
        return { main, effective: { choice: "this" }, picked: true, problem: true, candidates };
    }

    if (main.sees) return { main, effective: { choice: "this" }, picked: false, problem: false, candidates };
    if (main.keyId && main.sameKeyModels.length > 0) {
        return {
            main,
            effective: {
                choice: "another",
                keyId: main.keyId,
                keyName: main.name,
                model: main.sameKeyModels[0],
                sameKey: true,
            },
            picked: false,
            problem: false,
            candidates,
        };
    }
    return { main, effective: { choice: "universe-ai" }, picked: false, problem: false, candidates };
}

/** Whether a choice can be tapped: Universe AI while it is ready, another model only for the maker with a key that has one. */
export function canPickVision(options: BotAiOptions, state: VisionState, choice: VisionPick["choice"]): boolean {
    if (choice === "this") return true;
    if (choice === "universe-ai") return options.universeAi.available;
    return state.candidates.length > 0;
}

/** The bot with its images sent where the owner chose. For "Another model" the first offered is used unless one is named. */
export function withVisionChoice(
    bot: BotData,
    state: VisionState,
    choice: VisionPick["choice"],
    candidate?: VisionCandidate
): BotData {
    let vision: VisionPick;
    if (choice === "another") {
        const use = candidate ?? state.candidates[0];
        if (!use) return bot;
        vision = { choice: "another", keyId: use.keyId, model: use.model };
    } else {
        vision = { choice };
    }
    return { ...bot, behaviorConfig: { ...bot.behaviorConfig, vision } };
}
