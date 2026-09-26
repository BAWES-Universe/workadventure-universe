import { get } from "svelte/store";
import { AskPositionMessage_AskType } from "@workadventure/messages";
import LL from "../../../../i18n/i18n-svelte";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { scriptUtils } from "../../../Api/ScriptUtils";
import { WOKA_SPEED } from "../../../Enum/EnvironmentVariable";
import { wokaMenuStore } from "../../../Stores/WokaMenuStore";
import { rememberLocateRequest } from "../../../Phaser/Game/LocateRequest";
import { canOpenOrbit, openOrbitPage } from "../../../external-modules/admin-api/index";
import type { PersonLocation } from "./PersonTarget";
import { resolvePersonTarget } from "./PersonTarget";

/**
 * Walk to a person on this map. When their avatar is known locally we walk to that exact avatar (so another tab of
 * the same account is reachable); otherwise we ask the server by uuid, as before.
 */
export function walkToPerson(person: PersonLocation): void {
    // Nothing to walk on while a reconnect swaps the map.
    const scene = gameManager.tryGetCurrentGameScene();
    if (!scene) return;
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
export function locatePerson(person: PersonLocation, name?: string): void {
    const scene = gameManager.tryGetCurrentGameScene();
    if (!scene) return;
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

    // Their name shows on the card while the search runs.
    rememberLocateRequest(name);
    scene.connection?.emitAskPosition(target.uuid, target.playUri, AskPositionMessage_AskType.LOCATE);
}

/**
 * Go to the map a person is on. The destination map can only look the person up by account uuid.
 */
export function goToPersonRoom(person: PersonLocation): void {
    if (!person.playUri) return;
    scriptUtils.goToPage(`${person.playUri}#moveToUser=${person.uuid ?? ""}`);
}

/** Orbit's page for editing your visit card. */
export const EDIT_VISIT_CARD_PAGE = "/admin/profile";

/**
 * Your own row: there is no one to look for. The camera comes back to you and your own card opens, with your visit
 * card and, when you can use Orbit, a button to edit it there.
 */
export function showMyself(userUuid: string): void {
    const scene = gameManager.tryGetCurrentGameScene();
    if (!scene) return;
    scene.getCameraManager().returnToPlayer();
    wokaMenuStore.initialize(
        gameManager.getPlayerName() ?? "",
        scene.connection?.getUserId() ?? -1,
        userUuid,
        gameManager.myVisitCardUrl ?? undefined,
        true
    );
    if (!canOpenOrbit()) return;
    wokaMenuStore.addAction({
        actionName: get(LL).chat.userList.editMyVisitCard(),
        style: "is-primary",
        priority: 10,
        testId: "edit-my-visit-card",
        callback: () => {
            wokaMenuStore.clear();
            openOrbitPage(EDIT_VISIT_CARD_PAGE);
        },
    });
}
