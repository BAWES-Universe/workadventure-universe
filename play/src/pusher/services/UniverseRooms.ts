import { z } from "zod";

/** The admin's /api/room/sameUniverse answer: every room the player may see in their universe, grouped by world. */
export const UniverseRoomsData = z.object({
    universeName: z.string(),
    worlds: z.array(
        z.object({
            name: z.string(),
            slug: z.string(),
            thumbnailUrl: z.string().optional(),
            isCurrent: z.boolean(),
            rooms: z.array(
                z.object({
                    name: z.string(),
                    roomUrl: z.string(),
                    description: z.string().optional(),
                    stars: z.number().int().nonnegative(),
                    visits: z.number().int().nonnegative(),
                    peakHourUtc: z.number().int().min(0).max(23).optional(),
                    isCurrent: z.boolean(),
                })
            ),
        })
    ),
});

export type UniverseRoomsData = z.infer<typeof UniverseRoomsData>;
