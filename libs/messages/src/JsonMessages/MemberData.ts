import { z } from "zod";

export const MemberData = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  visitCardUrl: z.string().nullable().optional(), //Proto handle null here. If something goes wrong with personal area, this may be the issue
  chatID : z.string().nullable().optional(),
  // The member's WOKA in the world asked about, when the back office sends it.
  characterTextures: z.array(z.object({ id: z.string(), url: z.string() })).optional(),
});

export type MemberData = z.infer<typeof MemberData>;
