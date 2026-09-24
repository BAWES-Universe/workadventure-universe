import { get, writable } from "svelte/store";
import type { ExpressionSource } from "../Administration/AnalyticsClient";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { localUserStore } from "../Connection/LocalUserStore";
import type { Emoji } from "./Utils/emojiSchema";
import type { QuickPhrase } from "./Utils/quickPhraseSchema";
import { QUICK_PHRASE_KEYS, QUICK_PHRASE_MAX_LENGTH } from "./Utils/quickPhraseSchema";

function createEmoteMenuStore() {
    const { subscribe, set } = writable(false);

    return {
        subscribe,
        openEmoteMenu() {
            set(true);
        },
        closeEmoteMenu() {
            set(false);
        },
    };
}

function createEmoteDataStore() {
    const { subscribe, set, update } = writable(new Map<number, Emoji>());

    //check if favorite emoji already define
    const mapStored = localUserStore.getEmojiFavorite();
    if (mapStored != undefined) {
        set(mapStored);
    } else {
        const map = new Map<number, Emoji>();
        map.set(1, { emoji: "👍", name: "thumbs up" });
        map.set(2, { emoji: "❤️", name: "red heart" });
        map.set(3, { emoji: "😂", name: "face with tears of joy" });
        map.set(4, { emoji: "👏", name: "clapping hands" });
        map.set(5, { emoji: "😍", name: "smiling face with heart-eyes" });
        map.set(6, { emoji: "🙏", name: "folded hands" });
        set(map);
    }

    return {
        subscribe,
        pushNewEmoji(emoji: Emoji) {
            update((emojis: Map<number, Emoji>) => {
                emojis.set(get(emoteMenuSubCurrentEmojiSelectedStore), emoji);
                return emojis;
            });
        },
    };
}

function createEmoteMenuSubCurrentEmojiSelectedStore() {
    const { subscribe, set } = writable<number>(1);
    return {
        set,
        subscribe,
        select(selected: number) {
            set(selected);
        },
    };
}

export const emoteStore = writable<Emoji | null>(null);
/** The last emote played and where it came from, so the Express button can echo shortcut plays. */
export const emotePlayedStore = writable<{ emoji: string; source: ExpressionSource; at: number } | undefined>(
    undefined
);
export const emoteMenuSubCurrentEmojiSelectedStore = createEmoteMenuSubCurrentEmojiSelectedStore();
export const emoteMenuStore = createEmoteMenuStore();
export const emoteDataStore = createEmoteDataStore();

//subscribe to update localstorage favorite emoji
// This is a singleton, so we don't need to unsubscribe.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
emoteDataStore.subscribe((map: Map<number, Emoji>) => {
    localUserStore.setEmojiFavorite(map);
});

export type EmoteIndex = 1 | 2 | 3 | 4 | 5 | 6;

export const isEmoteIndex = (value: number): value is EmoteIndex => {
    return value >= 1 && value <= 6;
};

export const displayEmote = (emoteIndex: EmoteIndex, source: ExpressionSource) => {
    const emoji: Emoji | null | undefined = get(emoteDataStore).get(emoteIndex);
    if (emoji) {
        analyticsClient.launchEmote(emoji, source);
        emoteStore.set(emoji);
        emotePlayedStore.set({ emoji: emoji.emoji, source, at: Date.now() });
    }
};

const defaultQuickPhrases = (): QuickPhrase[] => QUICK_PHRASE_KEYS.map((key) => ({ key }));

function createQuickPhrasesStore() {
    const { subscribe, update } = writable<QuickPhrase[]>(localUserStore.getQuickPhrases() ?? defaultQuickPhrases());

    return {
        subscribe,
        /** Replaces a phrase with custom text. Empty text restores the translated default. */
        setPhrase(index: number, text: string) {
            if (index < 0 || index >= QUICK_PHRASE_KEYS.length) return;
            const trimmed = text.trim().slice(0, QUICK_PHRASE_MAX_LENGTH);
            update((phrases) => {
                const next = [...phrases];
                next[index] = trimmed === "" ? { key: QUICK_PHRASE_KEYS[index] } : { text: trimmed };
                return next;
            });
        },
    };
}

/** The four quick phrases of the Express tray. Shared across tabs like favourite emotes. */
export const quickPhrasesStore = createQuickPhrasesStore();

// This is a singleton, so we don't need to unsubscribe.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
quickPhrasesStore.subscribe((phrases) => {
    localUserStore.setQuickPhrases(phrases);
});
