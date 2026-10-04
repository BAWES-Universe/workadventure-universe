import { z } from "zod";
import type { ErrorScreenMessage } from "@workadventure/messages";
import { ABSOLUTE_PUSHER_URL } from "../Enum/ComputedConst";
import { localUserStore } from "./LocalUserStore";

/** Banned on the way in (the admin refused the room) or while inside (an admin just banned the player). */
export const BAN_CODES = ["BANNED", "USER_BANNED"];

export function isBanScreen(screen: ErrorScreenMessage | undefined): boolean {
    return screen?.code !== undefined && BAN_CODES.includes(screen.code);
}

/** The pusher's /ban/details answer, as the admin sent it. */
export const BanDetails = z.object({
    banned: z.boolean(),
    worldName: z.string().optional(),
    // No end date: the ban lasts until an admin lifts it.
    expiresAt: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    appeal: z
        .object({
            sentAt: z.string(),
            decision: z.enum(["pending", "kept", "lifted"]),
        })
        .nullable()
        .optional(),
});
export type BanDetails = z.infer<typeof BanDetails>;

export type BanAppealResult = "ok" | "already_appealed" | "not_banned";

function authHeaders(): Record<string, string> {
    return { Authorization: localUserStore.getAuthToken() ?? "" };
}

export async function fetchBanDetails(roomUrl: string): Promise<BanDetails> {
    const response = await fetch(`${ABSOLUTE_PUSHER_URL}ban/details?roomUrl=${encodeURIComponent(roomUrl)}`, {
        headers: authHeaders(),
        credentials: "include",
    });
    if (!response.ok) throw new Error(`Could not get the ban details: HTTP ${response.status}`);
    return BanDetails.parse(await response.json());
}

export async function sendBanAppeal(roomUrl: string, text: string): Promise<BanAppealResult> {
    const response = await fetch(`${ABSOLUTE_PUSHER_URL}ban/appeal`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomUrl, text }),
    });
    if (response.status === 409) return "already_appealed";
    if (response.status === 404) return "not_banned";
    if (!response.ok) throw new Error(`Could not send the appeal: HTTP ${response.status}`);
    return "ok";
}

/** Whole days left until the ban ends, at least one while it lasts. */
export function banDaysLeft(expiresAt: Date, now: Date = new Date()): number {
    return Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));
}
