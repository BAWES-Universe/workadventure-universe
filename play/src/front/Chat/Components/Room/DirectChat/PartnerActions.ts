import { gameManager } from "../../../../Phaser/Game/GameManager";
import { analyticsClient } from "../../../../Administration/AnalyticsClient";
import { blackListManager } from "../../../../WebRtc/BlackListManager";
import { showReportScreenStore } from "../../../../Stores/ShowReportScreenStore";
import { canOpenOrbit, openOrbitProfile, openOrbitProfileByChatId } from "../../../../external-modules/admin-api/index";
import { goToPersonRoom, locatePerson, walkToPerson } from "../../UserList/PersonNavigation";
import type { DirectPartner } from "./DirectPartnerStore";

function personOf(partner: DirectPartner) {
    const user = partner.user;
    return { spaceUserId: user?.spaceUserId, uuid: user?.uuid, playUri: user?.playUri };
}

/** Walk to them on your map, or travel to their map and walk to them there. */
export function walkToPartner(partner: DirectPartner): void {
    if (!partner.actions.walkTo) return;
    analyticsClient.goToUser();
    if (partner.user?.playUri === gameManager.tryGetCurrentGameScene()?.roomUrl) {
        walkToPerson(personOf(partner));
    } else {
        goToPersonRoom(personOf(partner));
    }
}

export function locatePartner(partner: DirectPartner, name: string): void {
    if (!partner.actions.locate) return;
    analyticsClient.openWokaMenu();
    locatePerson(personOf(partner), name);
}

/** A bot's chat account is @bot_<id>:<domain>, so a bot is known even when it isn't on the map right now. */
function isBotPartner(partner: DirectPartner): boolean {
    return partner.isBot || partner.chatId?.startsWith("@bot_") === true;
}

/**
 * Their profile in Orbit: for anyone with an account you can reach, never a bot, online or not. Orbit finds the
 * account itself from their account id (when they're here) or their Matrix id (when they're away).
 */
export function canOpenPartnerProfile(partner: DirectPartner): boolean {
    return (
        !isBotPartner(partner) && (partner.user?.uuid !== undefined || partner.chatId !== undefined) && canOpenOrbit()
    );
}

export function openPartnerProfile(partner: DirectPartner): void {
    if (isBotPartner(partner)) return;
    const uuid = partner.user?.uuid;
    if (uuid) openOrbitProfile(uuid);
    else if (partner.chatId) openOrbitProfileByChatId(partner.chatId);
}

/** Reporting goes through the game's report screen, which needs their account id. */
export function canReportPartner(partner: DirectPartner): boolean {
    return !partner.isBot && partner.user?.uuid !== undefined;
}

export function reportPartner(partner: DirectPartner, name: string): void {
    const uuid = partner.user?.uuid;
    if (uuid) showReportScreenStore.set({ userUuid: uuid, userName: name });
}

/**
 * Block or unblock: saved in your chat account (their messages are hidden on every device), and their voice, video
 * and nearby messages are hidden in the game too while they're around.
 */
export async function setPartnerBlocked(partner: DirectPartner, blocked: boolean): Promise<void> {
    if (!partner.chatId) return;
    await gameManager.chatConnection.setUserIgnored(partner.chatId, blocked);
    const uuid = partner.user?.uuid;
    if (!uuid) return;
    if (blocked) blackListManager.blackList(uuid);
    else blackListManager.cancelBlackList(uuid);
}
