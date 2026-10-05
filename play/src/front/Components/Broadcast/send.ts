import { get } from "svelte/store";
import { gameManager } from "../../Phaser/Game/GameManager";
import { AdminMessageEventTypes } from "../../Connection/AdminMessagesService";
import type { BroadcastReach } from "../../Stores/BroadcastStore";
import { broadcastReachInfoStore } from "../../Stores/BroadcastStore";
import { reachName } from "./reach";

function broadcastMeta(reach: BroadcastReach, caption?: string) {
    return {
        reach: reach.toLowerCase(),
        reachLabel: reachName(reach, get(broadcastReachInfoStore)) || undefined,
        caption: caption?.trim() || undefined,
    };
}

/** Sends a written notice to everyone in the reach. The text travels in the editor format older clients expect. */
export function sendBroadcastText(text: string, reach: BroadcastReach): void {
    const connection = gameManager.getCurrentGameScene().connection;
    if (!connection) throw new Error("Not connected");
    connection.emitGlobalMessage({
        type: AdminMessageEventTypes.admin,
        content: JSON.stringify({ ops: [{ insert: text.trim() + "\n" }] }),
        broadcastToWorld: reach !== "ROOM",
        broadcast: broadcastMeta(reach),
    });
}

/** Uploads a voice note (a recording or a file) and sends it to everyone in the reach, with an optional line of text. */
export async function sendBroadcastVoice(
    audio: Blob,
    fileName: string,
    reach: BroadcastReach,
    caption?: string
): Promise<void> {
    const connection = gameManager.getCurrentGameScene().connection;
    if (!connection) throw new Error("Not connected");
    const form = new FormData();
    form.append("file", audio, fileName);
    const uploaded = (await connection.uploadAudio(form)) as { path?: string };
    if (!uploaded?.path) throw new Error("The uploader returned no path");
    connection.emitGlobalMessage({
        type: AdminMessageEventTypes.audio,
        content: uploaded.path,
        broadcastToWorld: reach !== "ROOM",
        broadcast: broadcastMeta(reach, caption),
    });
}
