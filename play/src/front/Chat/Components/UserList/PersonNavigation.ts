import { get } from "svelte/store";
import { AskPositionMessage_AskType } from "@workadventure/messages";
import LL from "../../../../i18n/i18n-svelte";
import { gameManager } from "../../../Phaser/Game/GameManager";
import { scriptUtils } from "../../../Api/ScriptUtils";
import { WOKA_SPEED } from "../../../Enum/EnvironmentVariable";
import { wokaMenuStore } from "../../../Stores/WokaMenuStore";
import { rememberLocateRequest } from "../../../Phaser/Game/LocateRequest";
import { canOpenOrbit, openOrbitPage, openOrbitProfile } from "../../../external-modules/admin-api/index";
import { showReportScreenStore } from "../../../Stores/ShowReportScreenStore";
import { blackListManager } from "../../../WebRtc/BlackListManager";
import { analyticsClient } from "../../../Administration/AnalyticsClient";
import { peopleCardReturn } from "../../Stores/PeopleCardReturnStore";
import { openDirectChatRoom } from "../../Utils";
import type { PersonLocation } from "./PersonTarget";
import { avatarIdOf, resolvePersonTarget } from "./PersonTarget";
import type { Session } from "./PersonSessions";
import { pickSessionToReach } from "./PersonSessions";
import { IconDoorIn, IconMessage, IconPencil, IconUserCircle } from "@wa-icons";

/**
 * Of a person's sessions (tabs, devices) on this map, the one closest to you; `fallback` when none of them is in view.
 */
export function nearestSessionOnThisMap<T extends Session>(sessions: T[], fallback: T): T {
    const scene = gameManager.tryGetCurrentGameScene();
    if (!scene || sessions.length < 2) return fallback;
    const players = scene.getRemotePlayersRepository().getPlayers();
    const me = scene.CurrentPlayer;
    return pickSessionToReach(
        { primary: fallback, sessions },
        scene.roomUrl,
        me ? { x: me.x, y: me.y } : undefined,
        (userId) => players.get(userId)?.position
    );
}

/**
 * Walk to a person on this map. When their avatar is known locally we walk to that exact avatar (so another tab of
 * the same account is reachable); otherwise we ask the server, naming that avatar when we know which one it is.
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
        scene.connection?.emitAskPosition(target.uuid, target.playUri, AskPositionMessage_AskType.MOVE, target.userId);
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
            remotePlayer.showCard();
            return;
        }
    }
    if (target.kind !== "account") return;

    if (!target.avatarOnThisMap) {
        // No per-avatar id available: keep the previous behaviour and use a visible avatar of that account if any.
        const remotePlayerData = scene.getRemotePlayersRepository().getPlayerByUuid(target.uuid);
        const remotePlayer = remotePlayerData ? scene.MapPlayersByKey.get(remotePlayerData.userId) : undefined;
        if (remotePlayer) {
            remotePlayer.showCard();
            return;
        }
    }

    // Their name shows on the card while the search runs.
    rememberLocateRequest(name);
    scene.connection?.emitAskPosition(target.uuid, target.playUri, AskPositionMessage_AskType.LOCATE, target.userId);
}

/**
 * Go to the map a person is on, then walk to them there: to that exact avatar when it is known (one person can have
 * several, one per tab or device), else to the first one of their account.
 */
export function goToPersonRoom(person: PersonLocation): void {
    if (!person.playUri) return;
    const avatarId = avatarIdOf(person);
    const avatar = avatarId !== undefined ? `&moveToAvatar=${avatarId}` : "";
    scriptUtils.goToPage(`${person.playUri}#moveToUser=${person.uuid ?? ""}${avatar}`);
}

/** Orbit's page for editing your visit card. */
export const EDIT_VISIT_CARD_PAGE = "/admin/profile";

/**
 * Your own row: there is no one to look for. The camera comes back to you and your own card opens, with your visit
 * card and, when you can use Orbit, a button to edit it there.
 */
export function showMyself(userUuid: string | undefined): void {
    const scene = gameManager.tryGetCurrentGameScene();
    if (!scene) return;
    scene.getCameraManager().returnToPlayer();
    if (userUuid === undefined) {
        // No account id to show a card for: just close any open card.
        wokaMenuStore.clear();
        return;
    }
    wokaMenuStore.initialize(
        gameManager.getPlayerName() ?? "",
        scene.connection?.getUserId() ?? -1,
        userUuid,
        gameManager.myVisitCardUrl ?? undefined,
        true
    );
    if (!canOpenOrbit()) return;
    // Side by side: your profile as others see it (You, in Orbit), then the editor.
    wokaMenuStore.addAction({
        actionName: get(LL).chat.userList.viewProfile(),
        style: "bg-white/10 hover:bg-white/30",
        priority: 11,
        testId: "view-my-profile",
        actionIcon: IconUserCircle,
        callback: () => {
            wokaMenuStore.clear();
            openOrbitProfile(userUuid);
        },
    });
    wokaMenuStore.addAction({
        actionName: get(LL).chat.userList.editMyVisitCard(),
        style: "is-primary",
        priority: 10,
        testId: "edit-my-visit-card",
        actionIcon: IconPencil,
        callback: () => {
            wokaMenuStore.clear();
            openOrbitPage(EDIT_VISIT_CARD_PAGE);
        },
    });
}

/** Someone the People tab lists on another map: what their card needs. */
export interface CardPerson extends PersonLocation {
    uuid: string;
    chatId?: string;
    visitCardUrl?: string;
}

/**
 * "Show card" for someone on another map: the same card their avatar opens (their profile, Message, View profile,
 * Block or report under ⋯), with Go to room in place of Walk to. On this map, Locate opens it on their avatar.
 */
export function showPersonCard(person: CardPerson, name: string, canMessage: boolean): void {
    // The card has no avatar to follow here (-1), so the camera stays where it is.
    wokaMenuStore.initialize(name, -1, person.uuid, person.visitCardUrl);
    peopleCardReturn.tappedPerson(person.uuid);
    analyticsClient.openWokaMenu();

    const blocked = blackListManager.isBlackListed(person.uuid);
    if (!blocked && person.playUri) {
        wokaMenuStore.addAction({
            actionName: get(LL).chat.userList.goToRoom(),
            priority: 2,
            style: "bg-white/10 hover:bg-white/30",
            testId: "wokamenu-go-to-room-button",
            actionIcon: IconDoorIn,
            callback: () => {
                wokaMenuStore.clear();
                analyticsClient.goToUser();
                goToPersonRoom(person);
            },
        });
    }
    const chatId = person.chatId;
    if (chatId && canMessage) {
        wokaMenuStore.addAction({
            actionName: get(LL).chat.userList.message(),
            priority: 1,
            style: "bg-white/10 hover:bg-white/30",
            testId: "wokamenu-message-button",
            actionIcon: IconMessage,
            callback: () => {
                wokaMenuStore.clear();
                analyticsClient.openedChat();
                openDirectChatRoom(chatId).catch((error) => console.error("Error opening direct chat room:", error));
            },
        });
    }
    if (chatId && canOpenOrbit()) {
        wokaMenuStore.addAction({
            actionName: get(LL).chat.userList.viewProfile(),
            priority: 0,
            style: "bg-white/10 hover:bg-white/30",
            testId: "wokamenu-view-profile-button",
            actionIcon: IconUserCircle,
            callback: () => {
                wokaMenuStore.clear();
                openOrbitProfile(person.uuid);
            },
        });
    }
    wokaMenuStore.addAction({
        actionName: blocked ? get(LL).report.block.unblock() : get(LL).report.block.blockOrReport(),
        priority: -1,
        overflow: true,
        style: "text-red-500",
        testId: "wokamenu-block-user-button",
        callback: () => {
            wokaMenuStore.clear();
            analyticsClient.reportUser();
            showReportScreenStore.set({ userUuid: person.uuid, userName: name });
        },
    });
}

/** Your own avatar tapped or clicked on the map: your card opens, and the next tap closes it. */
export function toggleMyCard(userUuid: string | undefined): void {
    if (get(wokaMenuStore)?.isSelf) {
        wokaMenuStore.clear();
        return;
    }
    showMyself(userUuid);
}
