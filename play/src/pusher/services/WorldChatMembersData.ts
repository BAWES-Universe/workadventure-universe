import { z } from "zod";

const ChatMemberData = z.object({
    uuid: z.string(),
    wokaName: z.string().optional(),
    email: z
        .string()
        .nullable()
        .transform((value) => (value === null ? undefined : value)),
    chatId: z.string().optional(),
    tags: z.string().array(),
    // Older admins don't send a Woka: the member then has none.
    characterTextures: z
        .object({ id: z.string(), url: z.string() })
        .array()
        .optional()
        .transform((value) => value ?? []),
});

export const WorldChatMembersData = z.object({
    total: z.number().min(0),
    members: z.array(ChatMemberData),
});
export type WorldChatMembersData = z.infer<typeof WorldChatMembersData>;
