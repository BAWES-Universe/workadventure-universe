import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { gameManager } from "../../Phaser/Game/GameManager";

const linked = new Set<string>();

/**
 * Sends this account's direct messages for one device to Orbit's push gateway (#863): Orbit hands out the pusher,
 * the chat sets it on Synapse. Once per device and page; setting it again is harmless. In a room without chat nothing
 * is set, so the next save of this device tries again.
 */
export async function linkChatToDevice(deviceId: string): Promise<void> {
    if (linked.has(deviceId)) return;
    const pusher = await botApiService.getChatPusher(deviceId);
    if (!pusher) return;
    const connection = await gameManager.getChatConnection();
    if (await connection.setPusher(pusher)) linked.add(deviceId);
}
