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
        // The pusher fills in the sender's Woka from the connection.
        senderTextures: [],
    };
}

/** Sends a written notice to everyone in the reach: the rich editor's content (a Quill delta, as JSON). */
export function sendBroadcastText(delta: string, reach: BroadcastReach): void {
    const connection = gameManager.getCurrentGameScene().connection;
    if (!connection) throw new Error("Not connected");
    connection.emitGlobalMessage({
        type: AdminMessageEventTypes.admin,
        content: delta,
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
