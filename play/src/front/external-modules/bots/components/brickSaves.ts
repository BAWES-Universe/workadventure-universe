import type { BotData, BrickChange } from "../types";

/**
 * What a Brick's page keeps track of between saves (game Slice 13): the parts of a Brick the page's groups change.
 * `behavior` holds only the keys Orbit lets a Brick's page change (the Behavior group's and Mind's images); everything
 * else Orbit keeps in the Brick's behavior config (what Apps and the other parts store there) is never sent from here.
 */
export interface BrickSaved {
    description: string | null;
    chatInstructions: string | null;
    aiProviderRef: string | null;
    aiModel: string | null;
    behaviorType: "idle" | "patrol" | "social";
    behavior: Record<string, unknown>;
    companionTextureId: string | null;
}

/** The behavior config keys Orbit takes from a Brick's page (PATCH /api/bricks/:id). */
export const BRICK_BEHAVIOR_KEYS = [
    "behaviorType",
    "moves",
    "goesToPeople",
    "conversationRadius",
    "minTimeBetweenConversations",
    "facing",
    "assignedSpace",
    "vision",
] as const;

export function emptyBrickSaved(): BrickSaved {
    return {
        description: null,
        chatInstructions: null,
        aiProviderRef: null,
        aiModel: null,
        behaviorType: "idle",
        behavior: {},
        companionTextureId: null,
    };
}

function behaviorOf(bot: Pick<BotData, "behaviorConfig">): Record<string, unknown> {
    const config = bot.behaviorConfig ?? {};
    const picked: Record<string, unknown> = {};
    for (const key of BRICK_BEHAVIOR_KEYS) if (config[key] !== undefined) picked[key] = config[key];
    return picked;
}

/** What a Brick's page shows now, in the shape that is compared with what was saved. */
export function brickSavedOf(bot: BotData): BrickSaved {
    return {
        description: bot.description?.trim() || null,
        chatInstructions: bot.chatInstructions?.trim() || null,
        aiProviderRef: bot.aiProviderRef ?? null,
        aiModel: bot.aiModel ?? null,
        behaviorType: bot.behaviorType ?? "idle",
        behavior: behaviorOf(bot),
        companionTextureId: bot.companionTextureId ?? null,
    };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What changed from what was saved to what the page shows now: the body of the save. Empty when nothing did. */
export function brickChangeBetween(saved: BrickSaved, now: BrickSaved): BrickChange {
    const change: BrickChange = {};
    if (now.description !== saved.description) change.description = now.description;
    if (now.chatInstructions !== saved.chatInstructions) change.chatInstructions = now.chatInstructions;
    if (now.aiProviderRef !== saved.aiProviderRef) change.aiProviderRef = now.aiProviderRef;
    if (now.aiModel !== saved.aiModel) change.aiModel = now.aiModel;
    if (now.behaviorType !== saved.behaviorType) change.behaviorType = now.behaviorType;
    const behavior: Record<string, unknown> = {};
    for (const key of BRICK_BEHAVIOR_KEYS) {
        if (now.behavior[key] !== undefined && !same(now.behavior[key], saved.behavior[key]))
            behavior[key] = now.behavior[key];
    }
    if (Object.keys(behavior).length > 0) change.behaviorConfig = behavior;
    if (now.companionTextureId !== saved.companionTextureId) change.companionTextureId = now.companionTextureId;
    return change;
}

/** What was saved once `change` was: the saved state with those parts taken from what the page showed. */
export function brickSavedAfter(saved: BrickSaved, now: BrickSaved, change: BrickChange): BrickSaved {
    const after: BrickSaved = { ...saved, behavior: { ...saved.behavior } };
    if (change.description !== undefined) after.description = now.description;
    if (change.chatInstructions !== undefined) after.chatInstructions = now.chatInstructions;
    if (change.aiProviderRef !== undefined) after.aiProviderRef = now.aiProviderRef;
    if (change.aiModel !== undefined) after.aiModel = now.aiModel;
    if (change.behaviorType !== undefined) after.behaviorType = now.behaviorType;
    for (const key of Object.keys(change.behaviorConfig ?? {})) after.behavior[key] = now.behavior[key];
    if (change.companionTextureId !== undefined) after.companionTextureId = now.companionTextureId;
    return after;
}

/** The page after Orbit refused `change`: those parts go back to what was saved, and the rest stays as it is. */
export function brickPutBack(bot: BotData, saved: BrickSaved, change: BrickChange): BotData {
    const back: BotData = { ...bot };
    if (change.description !== undefined) back.description = saved.description ?? "";
    if (change.chatInstructions !== undefined) back.chatInstructions = saved.chatInstructions ?? "";
    if (change.aiProviderRef !== undefined) back.aiProviderRef = saved.aiProviderRef ?? undefined;
    if (change.aiModel !== undefined) back.aiModel = saved.aiModel;
    if (change.behaviorType !== undefined) back.behaviorType = saved.behaviorType;
    if (change.companionTextureId !== undefined) back.companionTextureId = saved.companionTextureId;
    if (change.behaviorConfig) {
        const config: BotData["behaviorConfig"] = { ...bot.behaviorConfig };
        for (const key of Object.keys(change.behaviorConfig)) {
            if (saved.behavior[key] === undefined) delete config[key];
            else config[key] = saved.behavior[key];
        }
        back.behaviorConfig = config;
    }
    return back;
}
