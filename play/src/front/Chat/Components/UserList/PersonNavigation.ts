import { AskPositionMessage_AskType } from "@workadventure/messages";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { scriptUtils } from "../../../Api/ScriptUtils";
import { WOKA_SPEED } from "../../../Enum/EnvironmentVariable";
import type { PersonLocation } from "./PersonTarget";
import { resolvePersonTarget } from "./PersonTarget";

/**
 * Walk to a person on this map. When their avatar is known locally we walk to that exact avatar (so another tab of
 * the same account is reachable); otherwise we ask the server by uuid, as before.
 */
export function walkToPerson(person: PersonLocation): void {
    const scene = gameManager.getCurrentGameScene();
    const players = scene.getRemotePlayersRepository().getPlayers();
    const target = resolvePersonTarget(person, scene.roomUrl, (userId) => players.has(userId));

    if (target.kind === "avatar") {
        const position = players.get(target.userId)?.position;
        if (position) {
            // Same speed and path finding as when the server answers a "walk to" request.
            scene.moveTo({ x: position.x, y: position.y }, false, WOKA_SPEED * 2.5).catch((error) => {
                console.warn(error);
            });
            return;
        }
    }
    if (target.kind === "account" && target.playUri) {
        scene.connection?.emitAskPosition(target.uuid, target.playUri);
    }
}

/**
 * Locate a person: open the woka menu on their avatar if it is in view, otherwise ask the server for their position.
 */
export function locatePerson(person: PersonLocation): void {
    const scene = gameManager.getCurrentGameScene();
    const target = resolvePersonTarget(person, scene.roomUrl, (userId) => scene.MapPlayersByKey.has(userId));

    if (target.kind === "avatar") {
        const remotePlayer = scene.MapPlayersByKey.get(target.userId);
        if (remotePlayer) {
            remotePlayer.activate();
            return;
        }
    }
    if (target.kind !== "account") return;

    if (!target.avatarOnThisMap) {
        // No per-avatar id available: keep the previous behaviour and use a visible avatar of that account if any.
        const remotePlayerData = scene.getRemotePlayersRepository().getPlayerByUuid(target.uuid);
        const remotePlayer = remotePlayerData ? scene.MapPlayersByKey.get(remotePlayerData.userId) : undefined;
        if (remotePlayer) {
            remotePlayer.activate();
            return;
        }
    }

    scene.connection?.emitAskPosition(target.uuid, target.playUri, AskPositionMessage_AskType.LOCATE);
}

/**
 * Go to the map a person is on. The destination map can only look the person up by account uuid.
 */
export function goToPersonRoom(person: PersonLocation): void {
    if (!person.playUri) return;
    scriptUtils.goToPage(`${person.playUri}#moveToUser=${person.uuid ?? ""}`);
}
