import { z } from "zod";

export const QUICK_PHRASE_KEYS = ["hi", "brb", "thanks", "ok"] as const;
export const QUICK_PHRASE_MAX_LENGTH = 24;

/**
 * A default phrase is stored by its translation key, so it follows the interface language.
 * Once edited, it is stored as the text the user typed.
 */
export const isQuickPhrase = z.union([
    z.object({ key: z.enum(QUICK_PHRASE_KEYS) }),
    z.object({ text: z.string().min(1).max(QUICK_PHRASE_MAX_LENGTH) }),
]);

export const arrayQuickPhrase = z.array(isQuickPhrase).length(QUICK_PHRASE_KEYS.length);

export type QuickPhraseKey = (typeof QUICK_PHRASE_KEYS)[number];
export type QuickPhrase = z.infer<typeof isQuickPhrase>;
