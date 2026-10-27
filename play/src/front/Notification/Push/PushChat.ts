import { z } from "zod";

/**
 * The Synapse pusher that sends this device's direct messages to Orbit (#863), as Orbit hands it out: the game sets it
 * with `pushers/set`, and Orbit's gateway checks `data.secret` on every message.
 */
export const ChatPusherSchema = z.object({
    kind: z.literal("http"),
    app_id: z.string().min(1),
    pushkey: z.string().min(1),
    app_display_name: z.string(),
    device_display_name: z.string(),
    lang: z.string(),
    data: z.object({ url: z.string().url(), secret: z.string().min(1) }),
});

export type ChatPusher = z.infer<typeof ChatPusherSchema>;

/** One tab's report to Orbit: Universe in front there or not, and the chat open in front. */
export interface PushActivityReport {
    tabId: string;
    front: boolean;
    chatRoomId: string | null;
}
