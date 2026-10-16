import { z } from "zod";
import { WokaDetail } from "./PlayerTextures";

/**
 * What the player wears and what they wore lately, as Orbit answers `GET /api/woka/mine`. It is a record of parts
 * made for one player in one room, so it lives apart from `wokaList` (a record of parts, which would reject it).
 */

/** Why the current Woka cannot be worn in this room. */
export const wokaNotWearableReason = z.enum([
  "other_place",
  "removed",
  "no_access",
]);
export type WokaNotWearableReason = z.infer<typeof wokaNotWearableReason>;

const wokaOutfit = z.object({
  /** The layers of the outfit, in the order they are drawn. */
  textures: z.array(WokaDetail),
  /** The texture's name when the outfit is one `woka` texture, else null (the game writes "Your WOKA"). */
  name: z.string().nullish(),
});

export const wokaMine = z.object({
  /** What the player wears now. Absent when they never picked one. */
  current: wokaOutfit
    .extend({
      wearableHere: z.boolean(),
      reason: wokaNotWearableReason.nullish(),
      /** The world (or universe) the Woka belongs to, when `reason` is `other_place` and there is exactly one. */
      placeName: z.string().nullish(),
    })
    .nullish(),
  /** What the popup offers instead. */
  suggestion: wokaOutfit
    .extend({
      /** True when the player wore it before, false when it is just the room's first Woka. */
      lastWorn: z.boolean(),
    })
    .nullish(),
  /** At most 4, newest first, only what this room allows. The current Woka comes first with `current: true`. */
  recent: z.array(
    wokaOutfit.extend({
      current: z.boolean().optional(),
    })
  ),
  companion: z
    .object({
      id: z.string(),
      url: z.string(),
      wearableHere: z.boolean(),
    })
    .nullish(),
});

export type WokaMine = z.infer<typeof wokaMine>;
export type WokaMineOutfit = z.infer<typeof wokaOutfit>;
