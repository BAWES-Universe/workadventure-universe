import * as Sentry from "@sentry/svelte";
import { get } from "svelte/store";
import type {
    ApplicationDefinitionInterface,
    AvailabilityStatus,
    ErrorApiErrorData,
    ErrorApiRetryData,
    ErrorApiUnauthorizedData,
} from "@workadventure/messages";
import { isRegisterData, MeResponse, ErrorScreenMessage } from "@workadventure/messages";
import { isAxiosError } from "axios";
import { defautlNativeIntegrationAppName, KlaxoonService } from "@workadventure/shared-utils";
import { Subject } from "rxjs";
import { asError } from "catch-unknown";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { userIsConnected, warningBannerStore } from "../Stores/MenuStore";
import { loginSceneVisibleIframeStore } from "../Stores/LoginSceneStore";
import { _ServiceWorker } from "../Network/ServiceWorker";
import { INSTALL_ROOM_PARAMETER, installRoomPath } from "../Install/InstallRoom";
import { GameConnexionTypes, urlManager } from "../Url/UrlManager";
import {
    CARDS_ENABLED,
    ENABLE_OPENID,
    ERASER_ENABLED,
    EXCALIDRAW_DOMAINS,
    EXCALIDRAW_ENABLED,
    GOOGLE_DOCS_ENABLED,
    GOOGLE_DRIVE_ENABLED,
    GOOGLE_SHEETS_ENABLED,
    GOOGLE_SLIDES_ENABLED,
    KLAXOON_CLIENT_ID,
    KLAXOON_ENABLED,
    TLDRAW_ENABLED,
    YOUTUBE_ENABLED,
} from "../Enum/EnvironmentVariable";
import { limitMapStore } from "../Stores/GameStore";
import { showLimitRoomModalStore } from "../Stores/ModalStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { locales } from "../../i18n/i18n-util";
import type { Locales } from "../../i18n/i18n-types";
import { setCurrentLocale } from "../Utils/locales";
import { ABSOLUTE_PUSHER_URL } from "../Enum/ComputedConst";
import { openChatRoom } from "../Chat/Utils";
import LL from "../../i18n/i18n-svelte";
import { errorScreenStore } from "../Stores/ErrorScreenStore";
import { refusedOnLoad } from "../Stores/WokaRefusedStore";
import { gameTokenToJoinWith } from "../external-modules/admin-api/orbitAccessToken";
import { axiosToPusher, axiosWithRetry } from "./AxiosUtils";
import { Room } from "./Room";
import { LocalUser } from "./LocalUser";
import { localUserStore } from "./LocalUserStore";
import { shouldSaveNameOnServer } from "./LocalUserUtils";
import type { OnConnectInterface, PositionInterface, ViewportInterface } from "./ConnexionModels";
import { RoomConnection } from "./RoomConnection";
import { watchConnectAttempt } from "./ConnectAttemptWatch";
import { softReconnect } from "./SoftReconnect";
import { HtmlUtils } from "./../WebRtc/HtmlUtils";
import { hasCapability } from "./Capabilities";

/** How a save of the WOKA or the companion ended: kept, refused for this place by the admin, or not saved at all. */
export type SaveResult = "saved" | "notAllowed" | "failed";

function saveFailure(err: unknown): SaveResult {
    const refused =
        isAxiosError(err) &&
        err.response?.status === 422 &&
        (err.response.data as { code?: unknown } | undefined)?.code === "WOKA_NOT_ALLOWED";
    return refused ? "notAllowed" : "failed";
}

export interface ConnectOptions {
    /** Whether whoever asked no longer wants this connection (the map was closed): no more retries, no screen changes. */
    cancelled?: () => boolean;
}

class ConnectionManager {
    private localUser!: LocalUser;

    private connexionType?: GameConnexionTypes;
    /** Failed attempts to open the room socket in a row: the first retry comes sooner. */
    private failedSocketAttempts = 0;
    private _unloading = false;
    /** Work held back while the page was being left, done if the browser shows the page again from its back cache. */
    private shownAgain: (() => void)[] = [];
    private authToken: string | null = null;
    private _currentRoom: Room | null = null;

    private serviceWorker?: _ServiceWorker;

    private _klaxoonToolActivated: boolean | undefined;
    private _klaxoonToolClientId: string | undefined;
    private _youtubeToolActivated: boolean | undefined;
    private _googleDocsToolActivated: boolean | undefined;
    private _googleSheetsToolActivated: boolean | undefined;
    private _googleSlidesToolActivated: boolean | undefined;
    private _eraserToolActivated: boolean | undefined;
    private _googleDriveActivated: boolean | undefined;
    private _excalidrawToolActivated: boolean | undefined;
    private _excalidrawToolDomains: string[] | undefined;
    private _cardsToolActivated: boolean | undefined;
    private _tldrawToolActivated: boolean | undefined;

    private _applications: ApplicationDefinitionInterface[] = [];

    private readonly _roomConnectionStream = new Subject<RoomConnection>();
    public readonly roomConnectionStream = this._roomConnectionStream.asObservable();
    private _roomConnection: RoomConnection | null = null;

    get unloading() {
        return this._unloading;
    }

    /** Does `then` if this page, now being left, is shown again from the browser's back cache, as it was. */
    public whenShownAgain(then: () => void): void {
        this.shownAgain.push(then);
    }

    constructor() {
        // The listener never needs to be removed, because we are in a singleton that is never destroyed.
        // eslint-disable-next-line listeners/no-missing-remove-event-listener,listeners/no-inline-function-event-listener
        window.addEventListener("beforeunload", () => {
            this._unloading = true;
        });
        // The page was left (Sign in, a link) and then shown again from the browser's back cache, as it was: it is not
        // closing any more, so a lost connection is retried again, and what was held back while leaving is done now.
        // eslint-disable-next-line listeners/no-missing-remove-event-listener,listeners/no-inline-function-event-listener
        window.addEventListener("pageshow", (event) => {
            if (!event.persisted) return;
            this._unloading = false;
            const heldBack = this.shownAgain;
            this.shownAgain = [];
            heldBack.forEach((then) => then());
        });

        // Initialise default application
        this.klaxoonToolActivated = KLAXOON_ENABLED;
        this._klaxoonToolClientId = KLAXOON_CLIENT_ID;
        if (this._klaxoonToolClientId) {
            KlaxoonService.initWindowKlaxoonActivityPicker();
        }
        this.youtubeToolActivated = YOUTUBE_ENABLED;
        this.googleDriveToolActivated = GOOGLE_DRIVE_ENABLED;
        this.googleDocsToolActivated = GOOGLE_DOCS_ENABLED;
        this.googleSheetsToolActivated = GOOGLE_SHEETS_ENABLED;
        this.googleSlidesToolActivated = GOOGLE_SLIDES_ENABLED;
        this.eraserToolActivated = ERASER_ENABLED;
        this.excalidrawToolActivated = EXCALIDRAW_ENABLED;
        this.excalidrawToolDomains = EXCALIDRAW_DOMAINS;
        this.cardsToolActivated = CARDS_ENABLED;
        this.tldrawToolActivated = TLDRAW_ENABLED;
    }

    /**
     * TODO fix me to be move in game manager
     *
     * Returns the URL that we need to redirect to load the OpenID screen, or "null" if no redirection needs to happen.
     *
     * @param manuallyTriggered - Whether the login request resulted from a click on the "Sign in" button or from a mandatory authentication.
     * @param providerId - The ID of the OpenID provider to use for authentication.
     * @param providerScopes - The scopes to request from the OpenID provider.
     */
    public loadOpenIDScreen(manuallyTriggered: boolean, providerId?: string, providerScopes?: string[]): URL | null {
        // A guest's name is kept aside too, for when they sign out again (not an account's: see backupGuestName).
        localUserStore.backupGuestName();
        localUserStore.setAuthToken(null);
        // Clear guest-picked textures/name/companion so OIDC user's
        // saved data loads from DB via the /room/access fallback.
        // The guest woka is kept aside and restored if the user comes back as a guest.
        localUserStore.backupGuestCharacterTextures();
        localUserStore.setCharacterTextures([]);
        if (!ENABLE_OPENID || !this._currentRoom) {
            analyticsClient.loggedWithToken();
            loginSceneVisibleIframeStore.set(false);
            return null;
        }
        analyticsClient.loggedWithSso();
        return this.openIdScreenUrl(this._currentRoom, manuallyTriggered, providerId, providerScopes);
    }

    /** The sign-in page (through the pusher) that comes back to this room once signed in. */
    private openIdScreenUrl(
        room: Room,
        manuallyTriggered: boolean,
        providerId?: string,
        providerScopes?: string[]
    ): URL {
        const redirectUrl = new URL("login-screen", ABSOLUTE_PUSHER_URL);
        redirectUrl.searchParams.append("playUri", room.key);
        if (manuallyTriggered) {
            redirectUrl.searchParams.append("manuallyTriggered", "true");
        }
        if (providerId) {
            redirectUrl.searchParams.append("providerId", providerId);
        }
        if (providerScopes) {
            providerScopes.forEach((scope) => {
                redirectUrl.searchParams.append("providerScopes", scope);
            });
        }
        return redirectUrl;
    }

    /**
     * The Sign in buttons: straight to the sign-in page from the room the player is in. Going through /login started the
     * whole app again just to forward, behind the loading screen, and left that page under the sign-in page: in the
     * installed iPhone app, closing the sign-in sheet landed on it, frozen and then empty (#1017). The room stays as it
     * is (the device keeps its token and WOKA), so closing the sheet, or Back in a browser, finds it as it was. Signing
     * in comes back to this room with the account's token, as through /login.
     */
    public goToSignIn(): void {
        localUserStore.backupGuestName();
        if (!ENABLE_OPENID || !this._currentRoom) {
            window.location.assign("/login");
            return;
        }
        analyticsClient.loggedWithSso();
        window.location.assign(this.openIdScreenUrl(this._currentRoom, true).toString());
    }

    /**
     * Logout
     */
    public logout() {
        // save the current token to use it in the redirect logout url
        const tokenTmp = localUserStore.getAuthToken();
        //remove token in localstorage
        localUserStore.setAuthToken(null);
        // The device kept the account's name: the next guest here gets their own back, or none, not this one (#1192).
        localUserStore.restoreGuestName();
        //user logout, set connected store for menu at false (actually don't do it because we are going to redirect and
        // it shortly displays the "sign in" button before redirect happens)
        //userIsConnected.set(false);

        // check if we are in a room
        if (!ENABLE_OPENID || !this._currentRoom) {
            window.location.assign("/login");
            return;
        }
        // redirect to logout url
        const redirectUrl = new URL(`${this._currentRoom.opidLogoutRedirectUrl}`, window.location.href);
        redirectUrl.searchParams.append("playUri", this._currentRoom.key);
        redirectUrl.searchParams.append("token", tokenTmp ?? "");

        gameManager
            .logout()
            .catch((e) => {
                console.error(e);
                Sentry.captureException(e);
            })
            .finally(() => window.location.assign(redirectUrl));
    }

    /**
     * Tries to login to the node server and return the starting map url to be loaded
     *
     * @return returns a promise to the Room we are going to load OR a pointer to the URL we must redirect to if authentication is needed.
     */
    public async initGameConnexion(): Promise<
        | {
              room: Room;
              nextScene: "selectCharacterScene" | "selectCompanionScene" | "gameScene";
          }
        | {
              nextScene: "errorScene";
              error: ErrorApiErrorData | ErrorApiRetryData | ErrorApiUnauthorizedData | Error;
          }
        | URL
    > {
        this.connexionType = urlManager.getGameConnexionType();
        this._currentRoom = null;

        let nextScene: "selectCharacterScene" | "selectCompanionScene" | "gameScene" = "gameScene";

        const urlParams = new URLSearchParams(window.location.search);
        let token = urlParams.get("token");
        // get token injected by post method from pusher
        if (token == undefined) {
            const input = HtmlUtils.getElementByIdOrFail<HTMLInputElement>("authToken");
            if (input.value != undefined && input.value != "") token = input.value;
        }

        if (token != undefined) {
            this.authToken = token;
            localUserStore.setAuthToken(token);

            //clean token of url
            urlParams.delete("token");
        }

        let matrixLoginToken = urlParams.get("matrixLoginToken");
        // get token injected by post method from pusher
        if (matrixLoginToken == undefined) {
            const input = HtmlUtils.getElementByIdOrFail<HTMLInputElement>("matrixLoginToken");
            if (input.value != undefined && input.value != "") {
                matrixLoginToken = input.value;
            }
        }

        if (matrixLoginToken != undefined) {
            localUserStore.setMatrixLoginToken(matrixLoginToken);
            //clean token of url
            urlParams.delete("matrixLoginToken");
        }

        if (this.connexionType === GameConnexionTypes.login) {
            this._currentRoom = await Room.createRoom(new URL(localUserStore.getLastRoomUrl()));
            const redirect = this.loadOpenIDScreen(true);
            if (redirect !== null) {
                return redirect;
            }
            urlManager.pushRoomIdToUrl(this._currentRoom);
        } else if (this.connexionType === GameConnexionTypes.jwt) {
            /** @deprecated */
            throw new Error("This endpoint is deprecated");
        }

        //@deprecated
        else if (this.connexionType === GameConnexionTypes.register) {
            const organizationMemberToken = urlManager.getOrganizationToken();
            const result = await axiosToPusher.post("register", { organizationMemberToken }).then((res) => res.data);

            const registerDataChecking = isRegisterData.safeParse(result);

            if (!registerDataChecking.success) {
                console.error("Invalid data received from /register route. Data: ", result);
                throw new Error("Invalid data received from /register route.");
            }

            const data = registerDataChecking.data;

            this.localUser = new LocalUser(data.userUuid, data.email);
            this.authToken = data.authToken;
            localUserStore.saveUser(this.localUser);
            localUserStore.setAuthToken(this.authToken);
            analyticsClient.loggedWithToken();

            const roomUrl = data.roomUrl;

            const query = urlParams.toString();
            this._currentRoom = await Room.createRoom(
                new URL(
                    window.location.protocol +
                        "//" +
                        window.location.host +
                        roomUrl +
                        (query ? "?" + query : "") + //use urlParams because the token param must be deleted
                        window.location.hash
                )
            );
            urlManager.pushRoomIdToUrl(this._currentRoom);
        } else if (this.connexionType === GameConnexionTypes.room || this.connexionType === GameConnexionTypes.empty) {
            this.authToken = localUserStore.getAuthToken();

            let roomPath: string;
            if (this.connexionType === GameConnexionTypes.empty) {
                roomPath = localUserStore.getLastRoomUrl();
                let lastRoomKnown = localUserStore.hasLastRoomUrl();
                //get last room path from cache api
                try {
                    const lastRoomUrl = await localUserStore.getLastRoomUrlCacheApi();
                    if (lastRoomUrl != undefined) {
                        roomPath = lastRoomUrl;
                        lastRoomKnown = true;
                    }
                } catch (err) {
                    console.error(err);
                    if (err instanceof Error) {
                        console.error(err.stack);
                    }
                }
                // The installed app's first launch, with empty storage: the room it was installed from.
                const installRoom = installRoomPath(urlParams.get(INSTALL_ROOM_PARAMETER));
                if (!lastRoomKnown && installRoom !== undefined) {
                    roomPath = window.location.protocol + "//" + window.location.host + installRoom;
                }
            } else {
                const query = urlParams.toString();
                roomPath =
                    window.location.protocol +
                    "//" +
                    window.location.host +
                    window.location.pathname +
                    (query ? "?" + query : "") + //use urlParams because the token param must be deleted
                    window.location.hash;
            }

            const roomPathUrl = new URL(roomPath);

            //get detail map for anonymous login and set texture in local storage
            //before set token of user we must load room and all information. For example the mandatory authentication could be require on current room
            this._currentRoom = await Room.createRoom(roomPathUrl);

            //Set last room visited! (connected or not, must be saved in localstorage and cache API)
            //use href to keep # value
            await localUserStore.setLastRoomUrl(roomPathUrl.href);

            //todo: add here some kind of warning if authToken has expired.
            if (!this.authToken) {
                if (!this._currentRoom.authenticationMandatory) {
                    await this.anonymousLogin();

                    // Back as a guest after a logout or an abandoned login: reuse the guest's woka
                    // rather than sending them through the woka picker again.
                    localUserStore.restoreGuestCharacterTextures();
                    const characterTextures = localUserStore.getCharacterTextures();
                    if (characterTextures === null || characterTextures.length === 0) {
                        nextScene = "selectCharacterScene";
                    } else {
                        // The game read the device when the page started, before the woka was put back: it joins with
                        // what it holds, so it must hold this one too, or the world refuses an empty woka. #987
                        gameManager.setCharacterTextureIds(characterTextures);
                    }
                } else {
                    const redirect = this.loadOpenIDScreen(false);
                    if (redirect === null) {
                        throw new Error("Unable to redirect on login page.");
                    }
                    return redirect;
                }
            } else {
                try {
                    const response = await this.checkAuthUserConnexion(this.authToken);
                    if (response.status === "error") {
                        /*if (response.type === "retry") {
                            console.warn("Token expired, trying to login anonymously");
                        } else {
                            console.error(response);
                        }*/

                        if (response.type === "redirect") {
                            return new URL(response.urlToRedirect, window.location.href);
                        }

                        return {
                            nextScene: "errorScene",
                            error: response,
                        };
                    }
                    if (response.status === "ok") {
                        // A world that refuses what the player wears asks them first: the join is refused too and opens
                        // the popup (WokaRefusedPopup), so no picker here. Without a Woka on the device there is nothing
                        // to ask about and the picker opens.
                        if (refusedOnLoad(response, localUserStore.getCharacterTextures())) {
                            nextScene = "gameScene";
                        } else if (response.isCharacterTexturesValid === false) {
                            nextScene = "selectCharacterScene";
                        } else if (response.isCompanionTextureValid === false) {
                            nextScene = "selectCompanionScene";
                        }

                        const chatRoomId = urlManager.getHashParameter("chatRoomId");

                        if (chatRoomId) {
                            openChatRoom(chatRoomId).catch((err) => {
                                console.error("Unable to open chat room or establish chat connection", err);
                                Sentry.captureException(err);
                            });
                        }
                    }
                } catch (err) {
                    if (isAxiosError(err) && err.response?.status === 401) {
                        console.warn("Token expired, trying to login anonymously");
                        // if the user must be connected to the current room or if the pusher error is not openid provider access error
                        if (this._currentRoom.authenticationMandatory) {
                            const redirect = this.loadOpenIDScreen(false);
                            if (redirect === null) {
                                throw new Error("Unable to redirect on login page.", { cause: err });
                            }
                            return redirect;
                        } else {
                            await this.anonymousLogin();
                        }
                    } else {
                        Sentry.captureException(err);
                        if (err instanceof Error) {
                            return {
                                nextScene: "errorScene",
                                error: err,
                            };
                        } else {
                            console.error("An unknown error occurred", err);
                            return {
                                nextScene: "errorScene",
                                error: new Error("An unknown error occurred"),
                            };
                        }
                    }
                }
            }
            // Todo: Replace with a real typing
            this.localUser = localUserStore.getLocalUser() as LocalUser; //if authToken exist in localStorage then localUser cannot be null
        }
        if (this._currentRoom == undefined) {
            return Promise.reject(new Error("Invalid URL"));
        }
        if (this.localUser) {
            analyticsClient.identifyUser(this.localUser.uuid, this.localUser.email);
        }

        //if limit room active test headband
        if (this._currentRoom.expireOn !== undefined) {
            warningBannerStore.activateWarningContainer();
            limitMapStore.set(true);

            //check time of map
            if (new Date() > this._currentRoom.expireOn) {
                showLimitRoomModalStore.set(true);
            }
        }

        this.serviceWorker = new _ServiceWorker();

        return Promise.resolve({
            room: this._currentRoom,
            nextScene,
        });
    }

    public async anonymousLogin(isBenchmark = false): Promise<void> {
        const data = await axiosWithRetry.post("anonymLogin").then((res) => res.data);
        this.localUser = new LocalUser(data.userUuid, data.email);
        this.authToken = data.authToken;
        if (!isBenchmark) {
            // In benchmark, we don't have a local storage.
            localUserStore.saveUser(this.localUser);
            localUserStore.setAuthToken(this.authToken);
        }
        this.anonymousMatrixLogin();
    }

    private anonymousMatrixLogin() {
        localUserStore.setMatrixLoginToken(null);
        localUserStore.setMatrixUserId(null);
        localUserStore.setMatrixAccessToken(null);
        localUserStore.setMatrixRefreshToken(null);
    }

    public initBenchmark(): void {
        this.localUser = new LocalUser("");
    }

    /**
     * Joining a room uses the game's token, whose OIDC access token runs out after about an hour: join with the newest
     * token there is, renewed first when it has run out.
     */
    private async useNewestAuthToken(roomUrl: string, isCurrent: () => boolean): Promise<void> {
        if (!this.authToken) return;
        try {
            this.authToken = await gameTokenToJoinWith(this.authToken, roomUrl, isCurrent);
        } catch (error) {
            // Browser storage can be unavailable: join with the token we have rather than not at all.
            console.warn("[ConnectionManager] Could not pick the newest sign-in token before joining a room", error);
        }
    }

    public async connectToRoomSocket(
        roomUrl: string,
        name: string,
        characterTextureIds: string[],
        position: PositionInterface,
        viewport: ViewportInterface,
        companionTextureId: string | null,
        availabilityStatus: AvailabilityStatus,
        lastCommandId?: string,
        options: ConnectOptions = {}
    ): Promise<OnConnectInterface | undefined> {
        await this.useNewestAuthToken(roomUrl, () => !options.cancelled?.());
        // The map that asked was closed while the token was renewed: don't open a socket for it.
        if (options.cancelled?.()) return undefined;
        return new Promise<OnConnectInterface | undefined>((resolve, reject) => {
            const connection = new RoomConnection(
                this.authToken,
                roomUrl,
                name,
                characterTextureIds,
                position,
                viewport,
                companionTextureId,
                availabilityStatus,
                lastCommandId
            );

            // A socket that never opens nor fails (a phone back from another app) is dropped, and retried below. Once
            // open, a slow join is left alone: the ping watchdog closes a silent socket.
            const stopWatch = watchConnectAttempt((reason, pendingMs) => {
                if (connection.isSocketOpen) return;
                console.info("[ConnectionManager] Connection attempt still pending: dropping it", reason, pendingMs);
                analyticsClient.connectAttemptDropped({ reason, pendingMs });
                connection.closeConnection();
                reject(new Error(`Connection attempt dropped (${reason}) after ${pendingMs} ms`));
            });

            // The roomJoinedMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
            //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
            connection.websocketErrorStream.subscribe((error: Event) => {
                stopWatch();
                console.info("onConnectError => An error occurred while connecting to socket server. Retrying", error);
                reject(asError(error));
            });

            // The roomJoinedMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
            //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
            connection.connectionErrorStream.subscribe((event: CloseEvent) => {
                stopWatch();
                console.info(
                    "An error occurred while connecting to socket server. Retrying => Event: ",
                    event.reason,
                    event.code,
                    event
                );

                //However, Chrome will rarely report any close code 1006 reasons to the Javascript side.
                //This is likely due to client security rules in the WebSocket spec to prevent abusing WebSocket.
                //(such as using it to scan for open ports on a destination server, or for generating lots of connections for a denial-of-service attack).
                // more detail here: https://www.rfc-editor.org/rfc/rfc6455#section-7.4.1
                if (event.code === 1006) {
                    //check cookies
                    const cookies = document.cookie.split(";");
                    for (const cookie of cookies) {
                        //check id cookie posthog exist
                        const numberIndexPh = cookie.indexOf("_posthog=");
                        if (numberIndexPh !== -1) {
                            //if exist, remove posthog cookie
                            document.cookie =
                                cookie.slice(0, numberIndexPh + 9) +
                                "; domain=.workadventu.re; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
                        }
                    }
                }

                reject(
                    new Error(
                        "An error occurred while connecting to socket server. Retrying. Code: " +
                            event.code +
                            ", Reason: " +
                            event.reason
                    )
                );
            });

            // The roomJoinedMessageStream stream is completed in the RoomConnection. No need to unsubscribe.
            //eslint-disable-next-line rxjs/no-ignored-subscription, svelte/no-ignored-unsubscribe
            connection.roomJoinedMessageStream.subscribe({
                // Ended without joining or failing: the connection was closed on purpose before the join (the world
                // is full, the Woka must be chosen again…) and that screen is already up. Nothing to retry.
                complete: () => stopWatch(),
                next: (connect: OnConnectInterface) => {
                    stopWatch();
                    // A join succeeded: the server is reachable, so the next failure is a first one again.
                    this.failedSocketAttempts = 0;
                    // The map that asked for this connection was closed meanwhile: it is not the app's connection, and
                    // the screen shown now belongs to the map that replaced it. The caller closes it.
                    if (options.cancelled?.()) {
                        resolve(connect);
                        return;
                    }
                    // Set the default application integration for the room
                    const KlaxoonApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.KLAXOON
                    );
                    this.klaxoonToolActivated = KlaxoonApp?.enabled ?? KLAXOON_ENABLED;

                    const YoutubeApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.YOUTUBE
                    );
                    this.youtubeToolActivated = YoutubeApp?.enabled ?? YOUTUBE_ENABLED;

                    const GoogleDriveApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.GOOGLE_DRIVE
                    );
                    this.googleDriveToolActivated = GoogleDriveApp?.enabled ?? GOOGLE_DRIVE_ENABLED;

                    const GoogleDocsApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.GOOGLE_DOCS
                    );
                    this.googleDocsToolActivated = GoogleDocsApp?.enabled ?? GOOGLE_DOCS_ENABLED;

                    const GoogleSheetsApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.GOOGLE_SHEETS
                    );
                    this.googleSheetsToolActivated = GoogleSheetsApp?.enabled ?? GOOGLE_SHEETS_ENABLED;

                    const GoogleSlidesApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.GOOGLE_SLIDES
                    );
                    this.googleSlidesToolActivated = GoogleSlidesApp?.enabled ?? GOOGLE_SLIDES_ENABLED;

                    const EraserApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.ERASER
                    );
                    this.eraserToolActivated = EraserApp?.enabled ?? ERASER_ENABLED;

                    const ExcalidrawApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.EXCALIDRAW
                    );
                    this.excalidrawToolActivated = ExcalidrawApp?.enabled ?? EXCALIDRAW_ENABLED;

                    const CardsApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.CARDS
                    );
                    this.cardsToolActivated = CardsApp?.enabled ?? CARDS_ENABLED;

                    const TldrawApp = connect.room.applications?.find(
                        (app) => app.name === defautlNativeIntegrationAppName.TLDRAW
                    );
                    this.tldrawToolActivated = TldrawApp?.enabled ?? TLDRAW_ENABLED;

                    // Set other applications
                    for (const app of connect.room.applications ?? []) {
                        if (
                            defautlNativeIntegrationAppName.KLAXOON === app.name ||
                            defautlNativeIntegrationAppName.YOUTUBE === app.name ||
                            defautlNativeIntegrationAppName.GOOGLE_DRIVE === app.name ||
                            defautlNativeIntegrationAppName.GOOGLE_DOCS === app.name ||
                            defautlNativeIntegrationAppName.GOOGLE_SHEETS === app.name ||
                            defautlNativeIntegrationAppName.GOOGLE_SLIDES === app.name ||
                            defautlNativeIntegrationAppName.ERASER === app.name ||
                            defautlNativeIntegrationAppName.EXCALIDRAW === app.name ||
                            defautlNativeIntegrationAppName.CARDS === app.name ||
                            defautlNativeIntegrationAppName.TLDRAW === app.name
                        ) {
                            continue;
                        }

                        // Save applications in the connection manager to use it in the map editor
                        if (this._applications.find((a) => a.name === app.name) === undefined) {
                            this._applications.push(app);
                        }
                    }
                    this._roomConnection = connection;
                    this._roomConnectionStream.next(connection);
                    errorScreenStore.delete();
                    resolve(connect);
                },
            });
        }).catch((err) => {
            console.info("connectToRoomSocket => catch => new Promise[OnConnectInterface] => err", err);

            // Keep any screen already shown: the "Reconnecting" one, or a real error the server sent (e.g. a ban). Nor
            // while the room is kept on screen with its pill (#958): it says so, and brings the full screen if it lasts.
            if (!get(errorScreenStore) && !softReconnect.isWaiting() && !options.cancelled?.()) {
                errorScreenStore.setError(
                    ErrorScreenMessage.fromPartial({
                        type: "reconnecting",
                        code: "reconnecting",
                        title: get(LL).messageScreen.connecting(),
                        subtitle: get(LL).messageScreen.pleaseWait(),
                        image:
                            gameManager?.currentStartedRoom?.loadingLogo ??
                            gameManager?.currentStartedRoom?.errorSceneLogo ??
                            "",
                    })
                );
            }
            // Let's retry in 4-6 seconds, sooner the first time (a phone coming back to the app often just needed its
            // network), and right away when the browser comes back online. A closed map's failure isn't counted: the map
            // replacing it would otherwise wait the longer delay on its own first failure.
            if (!options.cancelled?.()) this.failedSocketAttempts++;
            const retryDelay =
                this.failedSocketAttempts === 1
                    ? 1000 + Math.floor(Math.random() * 1000)
                    : 4000 + Math.floor(Math.random() * 2000);
            return new Promise<OnConnectInterface | undefined>((resolve) => {
                console.info("connectToRoomSocket => catch => new Promise[OnConnectInterface] => reconnectingTimeout");

                let ownTimeout: NodeJS.Timeout | null = null;
                const retry = () => {
                    window.removeEventListener("online", retry);
                    if (ownTimeout) clearTimeout(ownTimeout);
                    ownTimeout = null;
                    // The map that asked was closed: the map replacing it makes its own attempts.
                    if (options.cancelled?.()) return;
                    // The page is being left: no new attempt, unless the browser shows it again from its back cache.
                    if (this._unloading) {
                        this.whenShownAgain(retry);
                        return;
                    }
                    //todo: allow a way to break recursion?
                    //todo: find a way to avoid recursive function. Otherwise, the call stack will grow indefinitely.
                    console.info(
                        "[ConnectionManager] connectToRoomSocket => catch => ew Promise[OnConnectInterface] reconnectingTimeout => setTimeout",
                        roomUrl,
                        name,
                        characterTextureIds,
                        position,
                        viewport,
                        companionTextureId,
                        availabilityStatus,
                        lastCommandId
                    );

                    void this.connectToRoomSocket(
                        roomUrl,
                        name,
                        characterTextureIds,
                        position,
                        viewport,
                        companionTextureId,
                        availabilityStatus,
                        lastCommandId,
                        options
                    ).then((connection) => {
                        if (connection && !options.cancelled?.())
                            this._roomConnectionStream.next(connection.connection);
                        resolve(connection);
                    });
                };
                ownTimeout = setTimeout(retry, retryDelay);
                window.addEventListener("online", retry);
            });
        });
    }

    get getConnexionType() {
        return this.connexionType;
    }

    private async checkAuthUserConnexion(token: string) {
        //set connected store for menu at false
        userIsConnected.set(false);

        const playUri = this.currentRoom?.key;
        if (playUri == undefined) {
            throw new Error("playUri is undefined");
        }

        // TODO: the call to "/me" could be completely removed and the request data could come from the FrontController
        // For this to work, the authToken should be stored in a cookie instead of localStorage.
        const data = await axiosToPusher
            .get("me", {
                params: {
                    token,
                    playUri,
                    localStorageCharacterTextureIds: localUserStore.getCharacterTextures() ?? undefined,
                    localStorageCompanionTextureId: localUserStore.getCompanionTextureId() ?? undefined,
                    chatID: localUserStore.getChatId() ?? undefined,
                    name: localUserStore.getName() ?? undefined,
                },
            })
            .then((res) => {
                return res.data;
            })
            .catch((err) => {
                throw err;
            });

        const response = MeResponse.parse(data);

        if (response.status === "error") {
            // A refusal the pusher sent after renewing the token carries it: keep it, the old one may no longer work.
            const renewedToken = (data as { authToken?: unknown } | null)?.authToken;
            if (typeof renewedToken === "string") {
                localUserStore.setAuthToken(renewedToken);
                this.authToken = renewedToken;
            }
            return response;
        }

        const {
            authToken,
            userUuid,
            email,
            username,
            usernameFromAccount,
            locale,
            visitCardUrl,
            matrixUserId,
            matrixServerUrl,
            characterTextureIds,
        } = response;
        // Sync textures across devices — if server returned IDs, use them
        if (characterTextureIds && characterTextureIds.length > 0) {
            gameManager.setCharacterTextureIds(characterTextureIds);
            localUserStore.setCharacterTextures(characterTextureIds);
        }

        localUserStore.setAuthToken(authToken);
        this.localUser = new LocalUser(userUuid, email, matrixUserId /*, isMatrixRegistered*/);
        localUserStore.saveUser(this.localUser);
        this.authToken = authToken;

        if (matrixServerUrl) {
            gameManager.setMatrixServerUrl(matrixServerUrl);
        } else {
            gameManager.setMatrixServerUrl(undefined);
        }

        if (visitCardUrl) {
            gameManager.setVisitCardUrl(visitCardUrl);
        }

        const opidWokaNamePolicy = this.currentRoom?.opidWokaNamePolicy;
        if (username != undefined && opidWokaNamePolicy != undefined) {
            if (hasCapability("api/save-name")) {
                if (usernameFromAccount) {
                    gameManager.setPlayerName(username);
                    // The account's name is the one that counts. The device keeps a copy so it never comes back with an
                    // older name it held (#1192).
                    localUserStore.setName(username, true);
                } else {
                    // Orbit didn't answer with the name this time, so this is only the name from sign-in, which can be
                    // older than the account's name this device last got (#1192).
                    gameManager.setPlayerName(localUserStore.getAccountName(userUuid) ?? username);
                }
            } else {
                if (opidWokaNamePolicy === "force_opid") {
                    gameManager.setPlayerName(username);
                } else if (opidWokaNamePolicy === "allow_override_opid" && localUserStore.getName() == undefined) {
                    gameManager.setPlayerName(username);
                }
            }
        }

        if (locale) {
            try {
                if (locales.indexOf(locale as Locales) !== -1) {
                    await setCurrentLocale(locale as Locales);
                } else {
                    const nonRegionSpecificLocale = locales.find((l) => l.startsWith(locale.split("-")[0]));
                    if (nonRegionSpecificLocale) {
                        await setCurrentLocale(nonRegionSpecificLocale);
                    }
                }
            } catch (err) {
                console.warn("Could not set locale", err);
            }
        }

        //user connected, set connected store for menu at true
        if (localUserStore.isLogged()) {
            userIsConnected.set(true);
        }

        return response;
    }

    /**
     * A save got a 401: the pusher only answers that when the game token is missing, no longer valid or ran out (it lasts
     * 30 days), and /me refuses such a token too, so there is nothing to renew. A signed-in player goes to sign in again
     * and comes back to this room, as on entering a room with that token; a guest's save just did not happen (#945).
     */
    private signInAgainAfterRefusedToken(what: string): void {
        console.warn(`${what}: the game token was refused, sending a signed-in player to sign in again`);
        if (!localUserStore.isLogged()) return;
        const redirect = this.loadOpenIDScreen(false);
        if (redirect) window.location.assign(redirect.toString());
    }

    async saveName(name: string): Promise<boolean> {
        if (
            shouldSaveNameOnServer({
                hasNameCapability: Boolean(hasCapability("api/save-name")),
                hasAuthToken: this.authToken !== undefined,
                isSignedIn: localUserStore.isLogged(),
            })
        ) {
            try {
                await axiosToPusher.post(
                    "save-name",
                    {
                        name,
                        roomUrl: this.currentRoom?.key,
                    },
                    {
                        headers: {
                            Authorization: this.authToken,
                        },
                    }
                );
                return true;
            } catch (err) {
                if (isAxiosError(err) && err.response?.status === 401) {
                    this.signInAgainAfterRefusedToken("saveName");
                    return false;
                }
                console.error("saveName: HTTP POST failed", err);
                return false;
            }
        } else {
            console.warn(
                "saveName: skipped — missing auth or capability. authToken:",
                !!this.authToken,
                "capability:",
                hasCapability("api/save-name")
            );
            return false;
        }
    }

    /**
     * Saves the player's WOKA. "saved" also covers a guest (nothing is kept on an account, the device remembers it).
     * "notAllowed" is the admin refusing this WOKA here; "failed" is anything else, so the caller can tell the player
     * and keep what they wear.
     */
    async saveTextures(textures: string[]): Promise<SaveResult> {
        const result = await this.postAccountSave("saveTextures", "save-textures", { textures });
        if (result === "saved") {
            // Broadcast texture change to other users in the room via WebSocket
            this._roomConnection?.emitPlayerTextures(textures);
        }
        return result;
    }

    async saveCompanionTexture(texture: string | null): Promise<SaveResult> {
        return await this.postAccountSave("saveCompanionTexture", "save-companion-texture", { texture });
    }

    /** One save to the pusher. A 401 sends a signed-in player to sign in again (see signInAgainAfterRefusedToken). */
    private async postAccountSave(what: string, path: string, payload: object): Promise<SaveResult> {
        if (!hasCapability("api/save-textures") || this.authToken === undefined) {
            // A guest: no account to save to. The device keeps it, as before.
            console.warn(
                `${what}: skipped — missing auth or capability. authToken:`,
                !!this.authToken,
                "capability:",
                hasCapability("api/save-textures")
            );
            return "saved";
        }
        try {
            await axiosToPusher.post(
                path,
                { ...payload, roomUrl: this.currentRoom?.key },
                { headers: { Authorization: this.authToken } }
            );
            return "saved";
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 401) {
                this.signInAgainAfterRefusedToken(what);
                return "failed";
            }
            console.error(`${what}: HTTP POST failed`, err);
            return saveFailure(err);
        }
    }

    get currentRoom() {
        return this._currentRoom;
    }

    /**
     * The room the player is in now. The page only picks its first room at load; moving to another map (an exit,
     * WA.nav.goToRoom, the Explore list) does not reload the page, so each new map says where the player is. Saving a
     * Woka, a name or a companion tells Orbit which room it was picked in.
     */
    setCurrentRoom(room: Room): void {
        this._currentRoom = room;
    }

    get klaxoonToolActivated(): boolean {
        return this._klaxoonToolActivated ?? false;
    }
    set klaxoonToolActivated(activated: boolean | undefined) {
        this._klaxoonToolActivated = activated;
    }
    get klaxoonToolClientId(): string | undefined {
        return this._klaxoonToolClientId;
    }

    get youtubeToolActivated(): boolean {
        return this._youtubeToolActivated ?? false;
    }
    set youtubeToolActivated(activated: boolean | undefined) {
        this._youtubeToolActivated = activated;
    }

    get googleDocsToolActivated(): boolean {
        return this._googleDocsToolActivated ?? false;
    }
    set googleDocsToolActivated(activated: boolean | undefined) {
        this._googleDocsToolActivated = activated;
    }

    get googleSheetsToolActivated(): boolean {
        return this._googleSheetsToolActivated ?? false;
    }
    set googleSheetsToolActivated(activated: boolean | undefined) {
        this._googleSheetsToolActivated = activated;
    }

    get googleSlidesToolActivated(): boolean {
        return this._googleSlidesToolActivated ?? false;
    }
    set googleSlidesToolActivated(activated: boolean | undefined) {
        this._googleSlidesToolActivated = activated;
    }

    get eraserToolActivated(): boolean {
        return this._eraserToolActivated ?? false;
    }
    set eraserToolActivated(activated: boolean | undefined) {
        this._eraserToolActivated = activated;
    }

    get googleDriveToolActivated(): boolean {
        return this._googleDriveActivated ?? false;
    }
    set googleDriveToolActivated(activated: boolean | undefined) {
        this._googleDriveActivated = activated;
    }

    get excalidrawToolActivated(): boolean {
        return this._excalidrawToolActivated ?? false;
    }
    set excalidrawToolActivated(activated: boolean | undefined) {
        this._excalidrawToolActivated = activated;
    }

    get excalidrawToolDomains(): string[] {
        return this._excalidrawToolDomains ?? [];
    }
    set excalidrawToolDomains(domains: string[] | undefined) {
        this._excalidrawToolDomains = domains;
    }

    get cardsToolActivated(): boolean {
        return this._cardsToolActivated ?? false;
    }
    set cardsToolActivated(activated: boolean | undefined) {
        this._cardsToolActivated = activated;
    }

    get tldrawToolActivated(): boolean {
        return this._tldrawToolActivated ?? false;
    }
    set tldrawToolActivated(activated: boolean | undefined) {
        this._tldrawToolActivated = activated;
    }

    get applications(): ApplicationDefinitionInterface[] {
        return this._applications;
    }
}

export const connectionManager = new ConnectionManager();
