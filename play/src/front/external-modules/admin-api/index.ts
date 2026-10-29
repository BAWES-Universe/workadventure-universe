import { get } from "svelte/store";
import type { ExtensionModule, ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import { localUserStore } from "../../Connection/LocalUserStore";
import { userIsConnected, adminDashboardActivatedStore, adminDashboardPendingStore } from "../../Stores/MenuStore";
import { gameSceneIsLoadedStore } from "../../Stores/GameSceneStore";
import { canvasSize } from "../../Stores/CoWebsiteStore";
import { DESKTOP_LAYOUT_MIN_WIDTH } from "../../Stores/BarInViewStore";
import {
    modalFullScreenStore,
    modalIframeStore,
    modalIframeWindowStore,
    modalVisibilityStore,
} from "../../Stores/ModalStore";
import { orbitHoldsHistoryStore } from "../../Stores/OrbitHistoryStore";
import { gameManager } from "../../Phaser/Game/GameManager";
import { isUserNameValid, maxUserNameLength } from "../../Connection/LocalUserUtils";
import type { ModalEvent } from "../../Api/Events/ModalEvent";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { blackListManager } from "../../WebRtc/BlackListManager";
import { ringStore } from "../../Chat/Stores/RingStore";
import { openDirectChatRoom } from "../../Chat/Utils";
import { openProfileLinkHere, profileLinksOpeningHere } from "../../Chat/LinkPreview/ProfileLinks";
import { openArtifactFromCard } from "../../Artifacts/openArtifact";
import { artifactKindOf } from "../../Artifacts/artifactCard";
import {
    ORBIT_AUTH_VERSION,
    buildAdminLoginUrl,
    isOrbitAuthReadyMessage,
    resolveCredentialUrl,
    type OrbitAuthFailedMessage,
    type OrbitAuthTokenMessage,
    type OrbitAuthWaitMessage,
} from "./iframeAuth";
import {
    OrbitBridge,
    isOrbitBridgeAckMessage,
    isOrbitBridgeReadyMessage,
    isOrbitInvitePersonMessage,
    isOrbitMessagePersonMessage,
    isOrbitCheckLinksMessage,
    isOrbitOpenArtifactMessage,
    isOrbitOpenLinkMessage,
    isOrbitProfileChangedMessage,
    newRoomRevision,
    type OrbitEventTopic,
    type OrbitNavigateIntent,
} from "./orbitBridge";
import {
    forgetOrbitAccessTokenRenewal,
    getAccessTokenFromJwt,
    orbitAccessTokenHasExpired,
    orbitAccessTokenWithRetries,
} from "./orbitAccessToken";
let adminModalOpen = false;
/** The bridge for this visit (a new one on every room join or reconnect). */
let bridge: OrbitBridge | null = null;
/** The control that opened Orbit from the keyboard, to give focus back to when Orbit closes. */
let launcher: HTMLElement | null = null;
let unsubscribeUserConnected: (() => void) | null = null;
let unsubscribeModal: (() => void) | null = null;
let unsubscribeFullScreen: (() => void) | null = null;
let extensionOptions: ExtensionModuleOptions | null = null;
let adminOrigin: string | null = null;
/** A name you saved in your Orbit profile, shown in the game once Orbit closes. */
let pendingPlayerName: string | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

/**
 * Orbit was open when the connection dropped (a phone back from another app): once the game is back in, it opens
 * again on the page it was on (see openAdminModal's "resume"). Kept across the module's destroy and init, which the
 * rebuild runs, and forgotten as soon as a room is joined any other way or Orbit is opened by hand.
 */
interface OrbitResumeRequest {
    roomId: string;
    fullScreen: boolean;
}
let resumeRequest: OrbitResumeRequest | null = null;
/** The options a reopening was started for: both of the module's init timers reach it, only one may go on. */
let resumeStartedFor: ExtensionModuleOptions | null = null;
let stopWaitingToResume: (() => void) | null = null;
let resumeReadyWait: ReturnType<typeof setTimeout> | null = null;
/** A moment after the game is back in, so Orbit does not open in the middle of the room settling. */
const RESUME_OPEN_DELAY_MS = 400;
/** A reopened Orbit that has not signed in after this long closes again: nobody asked for an error window. */
const RESUME_READY_WAIT_MS = 20_000;

/**
 * Orbit's button in the bar goes away with the room (a reconnect rebuilds it) and comes back about a second after the
 * new one is joined. Meanwhile it keeps its place, greyed out, so the bar does not show Tools there and then swap it.
 * A world with no Orbit gives up waiting after this long.
 */
const ORBIT_BUTTON_WAIT_MS = 6_000;
let orbitButtonWait: ReturnType<typeof setTimeout> | null = null;

function holdOrbitButton() {
    adminDashboardPendingStore.set(true);
    if (orbitButtonWait !== null) clearTimeout(orbitButtonWait);
    orbitButtonWait = setTimeout(releaseOrbitButton, ORBIT_BUTTON_WAIT_MS);
}

function releaseOrbitButton() {
    if (orbitButtonWait !== null) clearTimeout(orbitButtonWait);
    orbitButtonWait = null;
    adminDashboardPendingStore.set(false);
}

function schedulePending(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        callback();
    }, delay);
    pendingTimers.add(timer);
}

function cancelPendingTimers() {
    for (const timer of pendingTimers) {
        clearTimeout(timer);
    }
    pendingTimers.clear();
}

/**
 * Orbit's place in the browser's history.
 *
 * Opening Orbit adds one entry, so the Back button (Android's, the browser's, a swipe) walks through Orbit's own pages
 * first (they share the tab's history) and then, on this entry, closes Orbit, never leaving the room. Closing Orbit
 * any other way steps back toward the room. Iframe navigations share the browser's history, so an old marker can
 * remain after an iframe closes; every opening has its own ID and older markers are stepped over, never reopened.
 */
let historyEntryId: string | null = null;

function isOrbitHistoryState(state: unknown): boolean {
    return !!state && typeof state === "object" && (state as { orbit?: unknown }).orbit === true;
}

function isCurrentOrbitHistoryState(state: unknown): boolean {
    return (
        historyEntryId !== null &&
        isOrbitHistoryState(state) &&
        (state as { orbitVisit?: unknown }).orbitVisit === historyEntryId
    );
}

/** How long the chat waits for a step back over Orbit's history to land before it adds its own steps anyway. */
const RELEASE_HISTORY_TIMEOUT_MS = 1000;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/** Orbit holds the top of the history (see OrbitHistoryStore): the chat adds no steps for now. */
function holdHistory(until: "released" | "landed") {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = until === "landed" ? setTimeout(releaseHistory, RELEASE_HISTORY_TIMEOUT_MS) : undefined;
    orbitHoldsHistoryStore.set(true);
}

function releaseHistory() {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = undefined;
    orbitHoldsHistoryStore.set(false);
}

function pushHistoryEntry() {
    if (historyEntryId !== null) return;
    try {
        const nextId = crypto.randomUUID();
        history.pushState({ orbit: true, orbitVisit: nextId }, "");
        historyEntryId = nextId;
        holdHistory("released");
    } catch (error) {
        console.warn("Could not add Orbit to the history", error);
    }
}

function dropHistoryEntry() {
    const wasCurrent = isCurrentOrbitHistoryState(history.state);
    historyEntryId = null;
    if (!wasCurrent) {
        releaseHistory();
        return;
    }
    // Held until the step back lands, so a chat opened from Orbit (Message) adds its step after it, not under it.
    holdHistory("landed");
    history.back();
}

function handlePopState(event: PopStateEvent) {
    if (adminModalOpen && !isCurrentOrbitHistoryState(event.state)) {
        // Back, on Orbit's entry: Orbit closes, and the room stays. Back took its step, so the history is free.
        historyEntryId = null;
        closeAdminModal();
        releaseHistory();
    }
    if (!adminModalOpen && isOrbitHistoryState(event.state)) {
        // An entry left behind by an earlier visit (Orbit was open during a room change): step over it.
        holdHistory("landed");
        history.back();
        return;
    }
    // A step back over Orbit's history has landed.
    if (historyEntryId === null && releaseTimer !== undefined) releaseHistory();
}

/** A key or a joystick held when Orbit opens would keep walking: its release never reaches the game. */
function clearHeldMovement() {
    gameManager.tryGetCurrentGameScene()?.userInputManager?.clearHeldMovement();
}

/**
 * How long Orbit's sign-in keeps trying while online with no answer from the play server, before Orbit offers Try
 * again. Time offline doesn't count: Orbit waits for the connection.
 */
const ORBIT_SIGN_IN_GIVE_UP_MS = 60_000;
/** A reopening after a reconnect tries for less: nobody is looking at a sign-in screen yet. */
const RESUME_SIGN_IN_GIVE_UP_MS = 15_000;

/** The sign-in Orbit's frame asked for last; an older one stops when Orbit asks again. */
let signInRequest: object | null = null;

function handleAdminAuthMessage(event: MessageEvent<unknown>) {
    if (
        !extensionOptions ||
        !adminOrigin ||
        event.origin !== adminOrigin ||
        !event.source ||
        event.source !== get(modalIframeWindowStore)
    )
        return;
    // After signing in, Orbit's bridge says it is ready and answers requests (see orbitBridge.ts).
    if (isOrbitBridgeReadyMessage(event.data)) {
        clearResumeReadyWait();
        bridge?.onReady();
        return;
    }
    if (isOrbitBridgeAckMessage(event.data)) {
        bridge?.onAck(event.data);
        return;
    }
    if (isOrbitProfileChangedMessage(event.data)) {
        // Orbit already saved it; the game only shows it, and only for this visit's frame.
        const name = event.data.name.trim();
        if (bridge && event.data.roomRevision === bridge.roomRevision && isUserNameValid(name))
            pendingPlayerName = name;
        return;
    }
    if (isOrbitInvitePersonMessage(event.data)) {
        // A request, like a tap on Invite in the People tab: the game checks reach, Busy and blocks itself.
        if (bridge && event.data.roomRevision === bridge.roomRevision)
            invitePersonFromOrbit(event.data.uuid, event.data.name.trim());
        return;
    }
    if (isOrbitMessagePersonMessage(event.data)) {
        if (bridge && event.data.roomRevision === bridge.roomRevision) messagePersonFromOrbit(event.data.chatId);
        return;
    }
    if (isOrbitCheckLinksMessage(event.data)) {
        // Which of someone's profile links the game can show, checked as chat links are, for this visit's Orbit only.
        const { requestId, roomRevision, urls } = event.data;
        const asking = bridge;
        if (asking && roomRevision === asking.roomRevision)
            profileLinksOpeningHere(urls)
                .then((openHere) => {
                    if (bridge === asking) asking.answerLinks(requestId, openHere);
                })
                .catch((error) => console.error("Could not check profile links for Orbit", error));
        return;
    }
    if (isOrbitOpenLinkMessage(event.data)) {
        // The window comes in front, and Orbit stays as it is behind it: its button brings it back.
        if (bridge && event.data.roomRevision === bridge.roomRevision) openProfileLinkHere(event.data.url);
        return;
    }
    if (isOrbitOpenArtifactMessage(event.data)) {
        // One of yours, from Your artifacts: the window comes in front, as its card opens it, and Orbit stays behind.
        // The game's server asks Orbit whether this person may open it.
        const { roomRevision, id, title, kind, artifactVersion, maker } = event.data;
        if (bridge && roomRevision === bridge.roomRevision)
            openArtifactFromCard(
                {
                    id: id.toLowerCase(),
                    version: artifactVersion,
                    title,
                    kind: artifactKindOf(kind),
                    maker: maker || undefined,
                },
                undefined
            );
        return;
    }
    if (!isOrbitAuthReadyMessage(event.data)) return;
    const { nonce, refresh } = event.data;
    const source = event.source;
    const origin = adminOrigin;
    const options = extensionOptions;
    if (!source || !options) return;
    const request = {};
    signInRequest = request;
    // Orbit may have closed, the room may have changed, or Orbit asked again, while the token was being renewed.
    const current = () =>
        extensionOptions === options && signInRequest === request && source === get(modalIframeWindowStore);
    const wait: OrbitAuthWaitMessage = { type: "orbit-auth-wait-v2", version: ORBIT_AUTH_VERSION, nonce };
    // Orbit learns at once that the game is there and working on it, so a slow renewal doesn't look like no game.
    source.postMessage(wait, origin);
    void orbitAccessTokenWithRetries(options, refresh === true, current, {
        giveUpAfterMs: ORBIT_SIGN_IN_GIVE_UP_MS,
        onWait: () => {
            if (current()) source.postMessage(wait, origin);
        },
    }).then((accessToken) => {
        if (!current()) return;
        signInRequest = null;
        if (!accessToken) {
            console.warn("Orbit sign-in: gave up getting a token for Orbit");
            const failed: OrbitAuthFailedMessage = { type: "orbit-auth-failed-v2", version: ORBIT_AUTH_VERSION, nonce };
            source.postMessage(failed, origin);
            return;
        }
        const response: OrbitAuthTokenMessage = {
            type: "orbit-auth-token-v2",
            version: ORBIT_AUTH_VERSION,
            nonce,
            accessToken,
        };
        source.postMessage(response, origin);
    });
}

/**
 * How long an invite or a chat from Orbit waits for the room's connection. Closing Orbit applies a name saved there
 * by rejoining the room, which drops the connection until the new one is up.
 */
const ROOM_CONNECTION_WAIT_MS = 15_000;

/** Orbit asked to invite someone over: Orbit closes so the invite and its answer are seen, and the game invites them. */
function invitePersonFromOrbit(uuid: string, name: string) {
    // Not yourself, and not someone you blocked here (the People tab offers neither).
    if (uuid === localUserStore.getLocalUser()?.uuid || blackListManager.isBlackListed(uuid)) return;
    closeAdminModal();
    // After closing, so a rejoin for a new name has already dropped the old connection and the invite uses the new one.
    // The wait's result is not checked on purpose: when the connection never came back (15 seconds), `ring` fails by
    // itself and shows the same "failed" toast as any invite that can't be sent, so there is nothing more to stop here.
    ringStore
        .whenConnected(ROOM_CONNECTION_WAIT_MS)
        .then(() => ringStore.ring(uuid, name))
        .catch((error) => console.error("Could not invite from Orbit", error));
}

/** Orbit asked to message someone: Orbit closes and the game opens their chat. */
function messagePersonFromOrbit(chatId: string) {
    if (chatId === localUserStore.getChatId()) return;
    closeAdminModal();
    // Like an invite, it waits out a rejoin so the chat opens in the room you end up in. The wait's result is not
    // checked on purpose: the chat connection belongs to the game manager and outlives a rejoin, so after the 15
    // seconds the chat can still open, and stopping here would make Message do nothing when it could have worked.
    ringStore
        .whenConnected(ROOM_CONNECTION_WAIT_MS)
        .then(() => openDirectChatRoom(chatId))
        .catch((error) => console.error("Could not open the chat from Orbit", error));
}

/**
 * What opened Orbit: the action-bar button, a quest's "Show me", the game asking Orbit for a page, or Orbit opening
 * on its own. Only the button opens it today; Orbit never opens on its own any more, and "auto" stays so the numbers
 * show it at zero. "resume" is Orbit opening again after a reconnect, because it was open when the connection dropped.
 */
export type OrbitOpenSource = "button" | "quest" | "link" | "auto" | "resume";

// Function to open the admin modal, optionally on a given Orbit page
function openAdminModal(options: ExtensionModuleOptions, source: OrbitOpenSource, redirect?: string) {
    // Opened by hand (or by the game for a page): whatever was waiting to reopen Orbit is no longer wanted.
    if (source !== "resume") forgetResume();
    if (adminModalOpen && redirect === undefined) return;

    const accessToken = getAccessTokenFromJwt(options.userAccessToken);
    if (!accessToken) {
        console.warn("No access token available for admin integration");
        return;
    }

    const adminUrl = options.adminUrl;
    if (!adminUrl) {
        console.error("Admin URL not configured. Set ADMIN_URL environment variable.");
        return;
    }

    let adminDashboardUrl: string;
    try {
        adminDashboardUrl = buildAdminLoginUrl(
            adminUrl,
            options.roomId,
            window.location.href,
            redirect,
            source === "resume"
        );
    } catch (error) {
        console.error("Refusing insecure Admin URL:", error);
        return;
    }

    const modalEvent: ModalEvent = {
        title: "Orbit",
        src: adminDashboardUrl,
        allow: "fullscreen",
        allowApi: true,
        position: "right",
        allowFullScreen: true,
    };

    if (adminModalOpen) {
        // Svelte batches synchronous visibility toggles, so closing and reopening in one turn never remounts the
        // iframe. Replace its reactive URL instead and keep its WindowProxy, launcher, view and history marker.
        bridge?.onClosed();
        modalIframeStore.set(modalEvent);
        analyticsClient.orbitOpened({ source });
        return;
    }

    // Reopened by the game, not by a tap: there is no control to give the focus back to.
    launcher = source !== "resume" ? keyboardFocusedControl() : null;
    clearHeldMovement();
    modalFullScreenStore.set(false);
    modalIframeStore.set(modalEvent);
    modalVisibilityStore.set(true);
    adminModalOpen = true;
    pushHistoryEntry();
    analyticsClient.orbitOpened({ source });
}

// Export function to open admin modal from menu item
export function openAdminModalFromMenu() {
    if (extensionOptions) {
        openAdminModal(extensionOptions, "button");
    }
}

/** Whether Orbit can be opened for this player (signed in, and Orbit is set up for this room). */
export function canOpenOrbit(): boolean {
    return (
        extensionOptions !== null &&
        !!extensionOptions.adminUrl &&
        getAccessTokenFromJwt(extensionOptions.userAccessToken) !== null
    );
}

/** Opens Orbit on one of its pages (an /admin path), switching to it if Orbit is already open. */
export function openOrbitPage(path: string) {
    if (!extensionOptions) return;
    openAdminModal(extensionOptions, "link", path);
}

/**
 * Asks Orbit for one of its pages by intent (Orbit decides the page, and whether this player may see it; anything it
 * does not allow lands on its home). Opens Orbit when it is closed; the request waits until Orbit has signed in.
 * Returns false when Orbit can't be opened for this player.
 */
export function requestOrbitPage(intent: OrbitNavigateIntent, params?: Record<string, string>): boolean {
    if (!extensionOptions || !bridge || !canOpenOrbit()) return false;
    if (!adminModalOpen) openAdminModal(extensionOptions, "link");
    bridge.navigate(intent, params);
    return true;
}

/**
 * Opens a player's profile in Orbit, by the id they play with: yours is You, anyone else's is their page. Orbit sends
 * guests and players it does not know to its home.
 */
export function openOrbitProfile(userUuid: string): boolean {
    return requestOrbitPage("user-profile", { userUuid });
}

/** Their profile in Orbit with the membership sheet already open, for the universe the player is in. */
export function openOrbitMembership(userUuid: string): boolean {
    return requestOrbitPage("user-profile", { userUuid, sheet: "membership" });
}

/**
 * The same page for someone the game only knows from a chat (a direct chat with a person who is away), by their exact
 * Matrix id. Orbit looks the account up itself and sends a Matrix id it has no account for to its home.
 */
export function openOrbitProfileByChatId(chatId: string): boolean {
    return requestOrbitPage("user-profile", { chatId });
}

/** Tells an open Orbit that something it shows changed (a hint to fetch again; it trusts nothing in it). */
export function notifyOrbitChanged(topic: OrbitEventTopic) {
    if (!adminModalOpen || !bridge) return;
    bridge.notifyChanged(topic);
}

/**
 * The control the keyboard has focused, or null. A control a click or tap focused is left alone: with the focus handed
 * back to it, Enter would press it again (reopening Orbit) instead of opening Express.
 */
function keyboardFocusedControl(): HTMLElement | null {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return null;
    try {
        return focused.matches(":focus-visible") ? focused : null;
    } catch {
        // A browser without :focus-visible: keep the focus return for everyone.
        return focused;
    }
}

// Function to close the admin modal
function closeAdminModal() {
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    modalIframeWindowStore.set(null);
    modalFullScreenStore.set(false);
    adminModalOpen = false;
    bridge?.onClosed();
}

/**
 * Orbit closed (by the player, by Orbit through WA.ui.modal.closeModal, or by Back): its history entry goes, and
 * focus returns to what opened it.
 */
function onOrbitClosed() {
    clearResumeReadyWait();
    bridge?.onClosed();
    dropHistoryEntry();
    const target = launcher;
    launcher = null;
    if (target?.isConnected) target.focus();
    applyPendingPlayerName();
}

/**
 * You renamed yourself in Orbit: the game takes the new name and rejoins the room, as renaming in the game does, so
 * everyone sees it. Nothing happens when the name didn't change.
 */
function applyPendingPlayerName() {
    const name = pendingPlayerName;
    pendingPlayerName = null;
    if (!name || name === gameManager.getPlayerName()) return;
    gameManager.setPlayerName(name);
    // Orbit already has it; this device keeps a copy too, so it never comes back with an older name (#1192).
    localUserStore.setName(name, localUserStore.isLogged());
    gameManager.rejoinCurrentRoom();
}

function forgetResume() {
    resumeRequest = null;
    stopWaitingToResume?.();
    stopWaitingToResume = null;
}

function clearResumeReadyWait() {
    if (resumeReadyWait !== null) clearTimeout(resumeReadyWait);
    resumeReadyWait = null;
}

/** Resolves once the room is back in and the page is on screen; never, if the module is torn down first. */
function whenRoomIsShown(): Promise<void> {
    stopWaitingToResume?.();
    return new Promise((resolve) => {
        let finished = false;
        let unsubscribe: (() => void) | null = null;
        const finish = () => {
            finished = true;
            document.removeEventListener("visibilitychange", check);
            unsubscribe?.();
            if (stopWaitingToResume === finish) stopWaitingToResume = null;
        };
        const check = () => {
            if (finished) return;
            if (get(gameSceneIsLoadedStore) && document.visibilityState !== "hidden") {
                finish();
                resolve();
            }
        };
        document.addEventListener("visibilitychange", check);
        stopWaitingToResume = finish;
        unsubscribe = gameSceneIsLoadedStore.subscribe(check);
        if (finished) unsubscribe();
    });
}

/**
 * Orbit was open when the connection dropped: open it again, on the page it was on, once the game is back in. It stays
 * closed when signing in again isn't possible (the sign-in token can't be renewed), and a request that the module's
 * teardown interrupted (the connection dropped again) is kept for the next room.
 */
async function resumeOrbit(options: ExtensionModuleOptions): Promise<void> {
    const request = resumeRequest;
    if (!request || resumeStartedFor === options) return;
    if (request.roomId !== options.roomId) {
        resumeRequest = null;
        return;
    }
    resumeStartedFor = options;
    const current = () => extensionOptions === options && resumeRequest === request;

    await whenRoomIsShown();
    await new Promise<void>((resolve) => {
        schedulePending(resolve, RESUME_OPEN_DELAY_MS);
    });
    if (!current()) return;

    let accessToken: string | null = null;
    try {
        accessToken = await orbitAccessTokenWithRetries(options, false, current, {
            giveUpAfterMs: RESUME_SIGN_IN_GIVE_UP_MS,
        });
    } catch (error) {
        console.warn("Orbit stays closed: could not check the sign-in before reopening it", error);
    }
    if (!current()) return;
    if (!accessToken || orbitAccessTokenHasExpired(accessToken)) {
        forgetResume();
        console.info("Orbit stays closed after the reconnect: the sign-in could not be renewed");
        return;
    }
    // The renewal can take a while: the person may have left the app again meanwhile.
    if (document.visibilityState === "hidden") {
        await whenRoomIsShown();
        if (!current()) return;
    }
    forgetResume();
    if (adminModalOpen) return;

    openAdminModal(options, "resume");
    // The full-screen view is only offered on a wide game: a window that got narrower meanwhile opens compact.
    if (request.fullScreen && get(canvasSize).width >= DESKTOP_LAYOUT_MIN_WIDTH) modalFullScreenStore.set(true);
    clearResumeReadyWait();
    resumeReadyWait = setTimeout(() => {
        resumeReadyWait = null;
        if (!adminModalOpen) return;
        console.warn("Orbit closed again: it did not sign in after the reconnect");
        closeAdminModal();
    }, RESUME_READY_WAIT_MS);
}

// Function to initialize the admin integration
function initializeAdminIntegration(options: ExtensionModuleOptions) {
    const accessToken = getAccessTokenFromJwt(options.userAccessToken);
    if (!accessToken) {
        console.warn("No access token available for admin integration");
        releaseOrbitButton();
        return;
    }

    const adminUrl = options.adminUrl;
    if (!adminUrl) {
        console.error("Admin URL not configured. Set ADMIN_URL environment variable.");
        releaseOrbitButton();
        return;
    }

    // Store options for cleanup
    try {
        adminOrigin = resolveCredentialUrl(adminUrl, window.location.href).origin;
    } catch (error) {
        console.error("Refusing insecure Admin URL:", error);
        releaseOrbitButton();
        return;
    }
    extensionOptions = options;
    // A new visit: a new room revision, so nothing from an earlier Orbit frame can act on this one.
    bridge?.onClosed();
    bridge = new OrbitBridge(
        {
            post: (message) => {
                const frame = get(modalIframeWindowStore);
                if (frame && adminOrigin) frame.postMessage(message, adminOrigin);
            },
            setTimeout: (callback, ms) => setTimeout(callback, ms),
            clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
        },
        newRoomRevision(),
        maxUserNameLength
    );
    window.removeEventListener("message", handleAdminAuthMessage);
    window.addEventListener("message", handleAdminAuthMessage);
    window.removeEventListener("popstate", handlePopState);
    window.addEventListener("popstate", handlePopState);
    // Orbit lays itself out for the frame's size, whoever changed it.
    unsubscribeFullScreen?.();
    unsubscribeFullScreen = modalFullScreenStore.subscribe((full) => {
        bridge?.setView(full ? "full" : "compact");
    });

    // Activate the Orbit button in the action bar (highest priority). Orbit opens only when asked: this runs on every
    // room join and reconnect, so opening here would bring Orbit back each time.
    adminDashboardActivatedStore.set(true);
    releaseOrbitButton();
    if (options.reconnecting) {
        resumeOrbit(options).catch((error) => console.error("Could not reopen Orbit after the reconnect", error));
    }
}

const adminExtensionModule: ExtensionModule = {
    id: "admin-api-extension",
    calendarSynchronised: false,
    todoListSynchronized: false,

    init(roomMetadata: unknown, options: ExtensionModuleOptions) {
        console.log("Admin API Extension Module initialized");

        // Only a room joined again after the connection dropped brings Orbit back; any other join starts closed.
        if (!options.reconnecting) forgetResume();

        // The button holds its place until Orbit is ready, so the bar never shows something else there for a moment.
        if (localUserStore.isLogged()) holdOrbitButton();

        // Wait for user to be connected, then initialize
        unsubscribeUserConnected = userIsConnected.subscribe((connected) => {
            if (connected && localUserStore.isLogged()) {
                schedulePending(() => {
                    initializeAdminIntegration(options);
                }, 1000);
                if (unsubscribeUserConnected) {
                    unsubscribeUserConnected();
                    unsubscribeUserConnected = null;
                }
            }
        });

        // Also check if already connected
        if (localUserStore.isLogged()) {
            schedulePending(() => {
                initializeAdminIntegration(options);
            }, 1000);
        }

        // Listen for modal close events
        unsubscribeModal = modalVisibilityStore.subscribe((visible) => {
            if (!visible && adminModalOpen) {
                adminModalOpen = false;
                onOrbitClosed();
            }
        });
    },

    destroy() {
        // Orbit open as the room is rebuilt: if this is a reconnect, the next room opens it again (see resumeOrbit).
        if (adminModalOpen && extensionOptions) {
            resumeRequest = { roomId: extensionOptions.roomId, fullScreen: get(modalFullScreenStore) };
        }
        stopWaitingToResume?.();
        stopWaitingToResume = null;
        clearResumeReadyWait();
        cancelPendingTimers();
        if (unsubscribeUserConnected) {
            unsubscribeUserConnected();
            unsubscribeUserConnected = null;
        }
        if (unsubscribeModal) {
            unsubscribeModal();
            unsubscribeModal = null;
        }
        // Deactivate the Orbit button
        adminDashboardActivatedStore.set(false);
        // The room is being rebuilt: Orbit comes back with the next one.
        if (localUserStore.isLogged()) holdOrbitButton();
        window.removeEventListener("message", handleAdminAuthMessage);
        window.removeEventListener("popstate", handlePopState);
        unsubscribeFullScreen?.();
        unsubscribeFullScreen = null;
        closeAdminModal();
        // The room is changing: its history entry stays behind and is stepped over later (see handlePopState).
        historyEntryId = null;
        releaseHistory();
        pendingPlayerName = null;
        bridge = null;
        launcher = null;
        extensionOptions = null;
        adminOrigin = null;
        forgetOrbitAccessTokenRenewal();
    },
};

export default adminExtensionModule;
