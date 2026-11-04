import { readable, type Readable } from "svelte/store";
import { localUserStore } from "../../Connection/LocalUserStore";
import { botApiService } from "./services/BotApiService";

/** How a bot and a person stand: the bot's own feelings, and what it thinks the person feels. */
export interface BotEmotions {
    botEmotion: { anger: number; happiness: number; trust: number; familiarity: number };
    personEmotion: { anger: number; happiness: number; trust: number };
}

/** What a bot's card shows below its name (#1790). */
export interface BotCardInfo {
    /** Still on its way: the card shows no buttons yet. */
    loading: boolean;
    /** What the bot's owner wrote about it. */
    description?: string;
    /** `null`: nothing known yet (you haven't met), shown as such. `undefined`: no feelings to show (a guest without an account). */
    emotions?: BotEmotions | null;
}

const descriptions = new Map<string, string | undefined>();

/** The description of a bot, asked once per session: an owner's rewrite shows the next time the game loads. */
async function descriptionOf(botId: string): Promise<string | undefined> {
    if (descriptions.has(botId)) return descriptions.get(botId);
    let description: string | undefined;
    try {
        description = (await botApiService.getBot(botId)).description?.trim() || undefined;
    } catch (error) {
        // Not known (a guest, or Orbit not answering): the card shows without it, and asks again at the next look
        console.error("[Bot card] Could not read the bot's description:", error);
        return undefined;
    }
    descriptions.set(botId, description);
    return description;
}

/**
 * How the bot feels about you, asked at every look: it moves with every chat, so a kept answer would be wrong.
 * `undefined` for someone without an account (nothing to stand on), `null` when the bot server has nothing to say.
 */
async function emotionsOf(botId: string): Promise<BotEmotions | null | undefined> {
    const playerUuid = localUserStore.getLocalUser()?.uuid;
    if (!playerUuid) return undefined;
    try {
        // The service's own address: it is null when the configured one was refused, and then the tokens go nowhere.
        const botServerUrl = botApiService.getBotServerUrl();
        if (!botServerUrl) throw new Error("No safe bot-server address");
        const response = await fetch(`${botServerUrl}/api/bots/${botId}/emotions/${playerUuid}`, {
            headers: await botApiService.getEmotionsHeaders(),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { emotions?: BotEmotions | null };
        return data.emotions ?? null;
    } catch (error) {
        console.error("[Bot card] Error fetching bot emotions:", error);
        return null;
    }
}

/**
 * What a bot's card shows: its description and how it feels about you. The card holds its buttons back until both are
 * in (`loading`), then both show at once.
 */
export function botCardInfo(botId: string): Readable<BotCardInfo> {
    return readable<BotCardInfo>({ loading: true }, (set) => {
        let live = true;
        Promise.all([descriptionOf(botId), emotionsOf(botId)])
            .then(([description, emotions]) => {
                if (live) set({ loading: false, description, emotions });
            })
            .catch(() => {
                if (live) set({ loading: false });
            });
        return () => {
            live = false;
        };
    });
}
