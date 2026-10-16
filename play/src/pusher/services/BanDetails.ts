import { z } from "zod";

/**
 * The admin's /api/ban/details answer: whether the player is banned from the world of a room, and what the ban screen
 * shows about it (the world's name, the end date, the reason and the player's appeal, if any).
 */
export const BanDetailsData = z.object({
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

export type BanDetailsData = z.infer<typeof BanDetailsData>;

/** What the admin said about an appeal: sent, or refused because one was already sent or the player is not banned. */
export type BanAppealResult = "ok" | "already_appealed" | "not_banned";

export const BAN_APPEAL_MAX_LENGTH = 1000;
