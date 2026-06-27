import type { WokaList } from "@workadventure/messages";

export interface WokaServiceInterface {
    /**
     * Returns the list of all available Wokas for the current user.
     */
    getWokaList(roomUrl: string, token: string, context?: string, botId?: string): Promise<WokaList | undefined>;
}
