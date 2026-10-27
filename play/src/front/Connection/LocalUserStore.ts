import { z } from "zod";
import { PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH, PEER_VIDEO_RECOMMENDED_BANDWIDTH } from "../Enum/EnvironmentVariable";
import type { Emoji } from "../Stores/Utils/emojiSchema";
import { arrayEmoji } from "../Stores/Utils/emojiSchema";
import type { QuickPhrase } from "../Stores/Utils/quickPhraseSchema";
import { arrayQuickPhrase } from "../Stores/Utils/quickPhraseSchema";
import type { RequestedStatus } from "../Rules/StatusRules/statusRules";
import { requestedStatusFactory } from "../Rules/StatusRules/StatusFactory/RequestedStatusFactory";
import { INITIAL_SIDEBAR_WIDTH } from "../Stores/ChatStore";
import { isAndroid, isIOS } from "../WebRtc/DeviceUtils";
import type { InstallCardRecord } from "../Install/InstallApp";
import type { LocalUser } from "./LocalUser";
import { areCharacterTexturesValid, isUserNameValid } from "./LocalUserUtils";

const playerNameKey = "playerName";
const selectedPlayerKey = "selectedPlayer";
const customCursorPositionKey = "customCursorPosition";
const requestedCameraStateKey = "requestedCameraStateKey";
const requestedMicrophoneStateKey = "requestedMicrophoneStateKey";
const characterTexturesKey = "characterTextures";
const guestCharacterTexturesKey = "guestCharacterTextures";
// Only names a guest typed are kept here. A new key, so no name an earlier build backed up can come back (#1271).
const guestNameKey = "guestTypedPlayerNameBackup";
// The name a guest typed last: the only name backupGuestName keeps aside (#1271).
const guestTypedNameKey = "guestTypedPlayerName";
const playerNameIsAccountsKey = "playerNameIsAccounts";
const companionKey = "companion";
const audioPlayerVolumeKey = "audioVolume";
const audioPlayerMuteKey = "audioMute";
const helpCameraSettingsShown = "helpCameraSettingsShown";
const fullscreenKey = "fullscreen";
const blockAudio = "blockAudio";
const forceCowebsiteTriggerKey = "forceCowebsiteTrigger";
const ignoreFollowRequests = "ignoreFollowRequests";
const decreaseAudioPlayerVolumeWhileTalking = "decreaseAudioPlayerVolumeWhileTalking";
const disableAnimations = "disableAnimations";
const lastRoomUrl = "lastRoomUrl";
const authToken = "authToken";
const guestTokenAsideKey = "guestTokenAside";
/** How long a guest's token kept aside for sign-in stays good: long enough to sign in, not for the next person on a shared device. */
const GUEST_TOKEN_ASIDE_MS = 30 * 60 * 1000;
const notification = "notificationPermission";
const allowPictureInPicture = "allowPictureInPicture";
const chatSounds = "chatSounds";
const preferredVideoInputDevice = "preferredVideoInputDevice";
const preferredAudioInputDevice = "preferredAudioInputDevice";
const cacheAPIIndex = "workavdenture-cache";
const userProperties = "user-properties";
const cameraPrivacySettings = "cameraPrivacySettings";
const microphonePrivacySettings = "microphonePrivacySettings";
// Phones keep their own "Keep microphone active in away mode" setting, off unless the person turns it on. Leaving the
// browser on a phone usually means using the camera or taking a call, which a live microphone blocks. The shared key
// above was saved as "on" automatically the first time the game read it, so phones start fresh rather than reuse it.
const phoneMicrophonePrivacySettings = "phoneMicrophonePrivacySettings";
const emojiFavorite = "emojiFavorite";
const quickPhrases = "quickPhrases";
const speakerDeviceId = "speakerDeviceId";
const matrixUserId = "matrixUserId";
const matrixAccessToken = "matrixAccessToken";
const matrixAccessTokenExpireDate = "matrixAccessTokenExpireDate";
const matrixRefreshToken = "matrixRefreshToken";
const matrixDeviceId = "matrixDeviceId";
const matrixLoginToken = "matrixLoginToken";
const requestedStatus = "RequestedStatus";
const matrixGuest = "matrixGuest";
const volumeProximityDiscussion = "volumeProximityDiscussion";
const foldersOpened = "foldersOpened";
const cameraContainerHeightKey = "cameraContainerHeight";
const chatSideBarWidthKey = "chatSideBarWidth";
const mapEditorSideBarWidthKey = "mapEditorSideBarWidthKey";
const lookAroundHintSeenKey = "lookAroundHintSeen";
const editHintSeenKey = "editHintSeen";
const recentEditObjectsKey = "recentEditObjects";
const bubbleSound = "bubbleSound";
const knownMediaDevices = "knownMediaDevices";
// The old flag "the card was shown once": only read to move it to the record (installCard).
const installCardSeenKey = "installCardSeen";
const installCardKey = "installCard";
const installReportedKey = "installReported";
const ignoredNewMediaDevices = "ignoredNewMediaDevices";

const isInstallCardRecord = z.object({
    lastShownAt: z.number().finite(),
    closeStreak: z.number().int().min(0),
    lastClosed: z.boolean(),
}) satisfies z.ZodType<InstallCardRecord>;

const INITIAL_MAP_EDITOR_SIDEBAR_WIDTH = 448;

const JwtAuthToken = z
    .object({
        accessToken: z.string().optional().nullable(),
    })
    .partial();

type JwtAuthToken = z.infer<typeof JwtAuthToken>;

const FoldersOpenedSchema = z.union([z.null(), z.array(z.string()).transform((arr) => new Set(arr))]);
const KnownMediaDevicesSchema = z.array(z.string());

interface PlayerVariable {
    value: undefined;
    isPublic: boolean;
}

class LocalUserStore {
    private jwt: JwtAuthToken | undefined;
    private name: string | undefined;

    saveUser(localUser: LocalUser) {
        localStorage.setItem("localUser", JSON.stringify(localUser));
    }

    getLocalUser(): LocalUser | null {
        const data = localStorage.getItem("localUser");
        return data ? JSON.parse(data) : null;
    }

    /**
     * fromAccount: the account's name (from Orbit, or a rename while signed in), not one a guest typed. It is kept
     * against the signed-in user, so another account on this device doesn't take it.
     */
    setName(name: string, fromAccount = false): void {
        this.name = name;
        localStorage.setItem(playerNameKey, name);
        if (fromAccount) {
            localStorage.setItem(playerNameIsAccountsKey, this.getLocalUser()?.uuid ?? "true");
        } else {
            localStorage.removeItem(playerNameIsAccountsKey);
            localStorage.setItem(guestTypedNameKey, name);
        }
    }

    /** The name this device last got as this account's own (see setName), if it holds one. */
    getAccountName(userUuid: string): string | null {
        return localStorage.getItem(playerNameIsAccountsKey) === userUuid ? this.getName() : null;
    }

    /**
     * Keeps a guest's name aside before signing in. The device keeps the account's name while signed in (#1192), and
     * signing out gives the guest's own back (restoreGuestName), as with the woka.
     */
    backupGuestName(): void {
        // Only a guest's: never the account's name the device kept, also once its sign-in was refused and the device
        // carried on as a guest.
        if (this.isLogged() || localStorage.getItem(playerNameIsAccountsKey) !== null) return;
        // And only one a guest typed: a name an older version stored may be an account's, and nothing tells them apart.
        const name = this.getName();
        if (name !== null && localStorage.getItem(guestTypedNameKey) === name) localStorage.setItem(guestNameKey, name);
    }

    /**
     * On signing out: the device goes back to the guest's own name, or to none, never the account's.
     * wasSignedIn: this device held an account's sign-in. Then a name nothing marks (stored by an older version, and not
     * one a guest typed) may be the account's too, and goes. Without it such a name stays: it is most likely a guest's.
     */
    restoreGuestName(wasSignedIn = false): void {
        // A guest's own name stays: it is only the account's name the device kept that goes (a guest can get here too,
        // when their token is refused).
        if (localStorage.getItem(playerNameIsAccountsKey) === null) {
            const name = this.getName();
            if (!wasSignedIn || name === null || localStorage.getItem(guestTypedNameKey) === name) return;
        }
        const backup = localStorage.getItem(guestNameKey);
        if (backup && isUserNameValid(backup)) {
            this.setName(backup);
            return;
        }
        this.name = undefined;
        localStorage.removeItem(playerNameKey);
        localStorage.removeItem(playerNameIsAccountsKey);
        localStorage.removeItem(guestTypedNameKey);
    }

    /**
     * Another account's name on this device, when this account is the one signed in now: the device goes back to the
     * guest's own name, or none. True when it did, so the game can be told.
     */
    dropOtherAccountsName(userUuid: string): boolean {
        const owner = localStorage.getItem(playerNameIsAccountsKey);
        // "true" is a name marked when no user was saved yet: nothing says whose it is.
        if (owner === null || owner === "true" || owner === userUuid) return false;
        this.restoreGuestName();
        return true;
    }

    getName(): string | null {
        if (this.name) {
            return this.name;
        }
        const value = localStorage.getItem(playerNameKey) || "";
        return isUserNameValid(value) ? value : null;
    }

    setPlayerCharacterIndex(playerCharacterIndex: number): void {
        localStorage.setItem(selectedPlayerKey, "" + playerCharacterIndex);
    }

    getPlayerCharacterIndex(): number {
        return parseInt(localStorage.getItem(selectedPlayerKey) || "");
    }

    setCustomCursorPosition(activeRow: number, selectedLayers: number[]): void {
        localStorage.setItem(customCursorPositionKey, JSON.stringify({ activeRow, selectedLayers }));
    }

    getCustomCursorPosition(): { activeRow: number; selectedLayers: number[] } | null {
        return JSON.parse(localStorage.getItem(customCursorPositionKey) || "null");
    }

    getRequestedCameraState(): boolean {
        return JSON.parse(localStorage.getItem(requestedCameraStateKey) || "true");
    }

    setRequestedCameraState(value: boolean): void {
        localStorage.setItem(requestedCameraStateKey, JSON.stringify(value));
    }

    getRequestedMicrophoneState(): boolean {
        return JSON.parse(localStorage.getItem(requestedMicrophoneStateKey) || "true");
    }

    setRequestedMicrophoneState(value: boolean): void {
        localStorage.setItem(requestedMicrophoneStateKey, JSON.stringify(value));
    }

    setCharacterTextures(textureIds: string[]): void {
        localStorage.setItem(characterTexturesKey, JSON.stringify(textureIds));
    }

    getCharacterTextures(): string[] | null {
        const value = JSON.parse(localStorage.getItem(characterTexturesKey) || "null");
        return areCharacterTexturesValid(value) ? value : null;
    }

    /**
     * Keeps the guest's woka aside before login clears it, so a guest who logs in and then logs out
     * (or abandons the login) comes back with the same woka instead of the woka picker.
     */
    backupGuestCharacterTextures(): void {
        const current = this.getCharacterTextures();
        if (current !== null) {
            localStorage.setItem(guestCharacterTexturesKey, JSON.stringify(current));
        }
    }

    /**
     * Restores the guest woka kept by backupGuestCharacterTextures(), only when no valid woka is stored.
     * A woka saved during the logged-in session (e.g. the account's own) always wins.
     */
    restoreGuestCharacterTextures(): boolean {
        if (this.getCharacterTextures() !== null) {
            return false;
        }
        let backup: unknown;
        try {
            backup = JSON.parse(localStorage.getItem(guestCharacterTexturesKey) || "null");
        } catch {
            return false;
        }
        if (!Array.isArray(backup) || !backup.every((id) => typeof id === "string")) {
            return false;
        }
        if (!areCharacterTexturesValid(backup)) {
            return false;
        }
        this.setCharacterTextures(backup);
        return true;
    }

    setCompanionTextureId(textureId: string | null): void {
        return localStorage.setItem(companionKey, JSON.stringify(textureId));
    }

    getCompanionTextureId(): string | null {
        const companion = JSON.parse(localStorage.getItem(companionKey) || "null");

        if (typeof companion !== "string" || companion === "") {
            return null;
        }

        return companion;
    }

    wasCompanionSet(): boolean {
        return localStorage.getItem(companionKey) ? true : false;
    }

    setAudioPlayerVolume(value: number): void {
        localStorage.setItem(audioPlayerVolumeKey, "" + value);
    }

    getAudioPlayerVolume(): number {
        return parseFloat(localStorage.getItem(audioPlayerVolumeKey) || "1");
    }

    setAudioPlayerMuted(value: boolean): void {
        localStorage.setItem(audioPlayerMuteKey, value.toString());
    }

    getAudioPlayerMuted(): boolean {
        return localStorage.getItem(audioPlayerMuteKey) === "true";
    }

    setHelpCameraSettingsShown(): void {
        localStorage.setItem(helpCameraSettingsShown, "1");
    }

    getHelpCameraSettingsShown(): boolean {
        return localStorage.getItem(helpCameraSettingsShown) === "1";
    }

    setFullscreen(value: boolean): void {
        localStorage.setItem(fullscreenKey, value.toString());
    }

    getFullscreen(): boolean {
        return localStorage.getItem(fullscreenKey) === "true";
    }

    setBlockAudio(value: boolean): void {
        localStorage.setItem(blockAudio, value.toString());
    }
    getBlockAudio(): boolean {
        return localStorage.getItem(blockAudio) === "true";
    }

    setForceCowebsiteTrigger(value: boolean): void {
        localStorage.setItem(forceCowebsiteTriggerKey, value.toString());
    }

    getForceCowebsiteTrigger(): boolean {
        return localStorage.getItem(forceCowebsiteTriggerKey) === "true";
    }

    setIgnoreFollowRequests(value: boolean): void {
        localStorage.setItem(ignoreFollowRequests, value.toString());
    }

    getIgnoreFollowRequests(): boolean {
        return localStorage.getItem(ignoreFollowRequests) === "true";
    }
    setDecreaseAudioPlayerVolumeWhileTalking(value: boolean): void {
        localStorage.setItem(decreaseAudioPlayerVolumeWhileTalking, value.toString());
    }
    getDecreaseAudioPlayerVolumeWhileTalking(): boolean {
        return localStorage.getItem(decreaseAudioPlayerVolumeWhileTalking) === "true";
    }

    setDisableAnimations(value: boolean): void {
        localStorage.setItem(disableAnimations, value.toString());
    }
    getDisableAnimations(): boolean {
        return localStorage.getItem(disableAnimations) === "true";
    }

    async setLastRoomUrl(roomUrl: string): Promise<void> {
        localStorage.setItem(lastRoomUrl, roomUrl.toString());
        if ("caches" in window) {
            try {
                const cache = await caches.open(cacheAPIIndex);
                const stringResponse = new Response(JSON.stringify({ roomUrl }));
                await cache.put(`/${lastRoomUrl}`, stringResponse);
            } catch (e) {
                console.error("Could not store last room url in Browser cache. Are you using private browser mode?", e);
            }
        }
    }

    // The install reads and writes never throw: a browser that blocks storage must still start the game.
    /** What the install card remembers: when it last showed and how it was closed. A malformed record counts as none. */
    readInstallCard(): InstallCardRecord | undefined {
        try {
            const record = this.parseInstallCard(localStorage.getItem(installCardKey));
            if (record !== undefined) return record;
            // The card used to show once, ever (a flag): that last showing counts as now, so it waits the gap.
            if (localStorage.getItem(installCardSeenKey) !== "true") return undefined;
            const migrated: InstallCardRecord = { lastShownAt: Date.now(), closeStreak: 0, lastClosed: false };
            localStorage.setItem(installCardKey, JSON.stringify(migrated));
            localStorage.removeItem(installCardSeenKey);
            return migrated;
        } catch (e) {
            console.warn("Could not read the install state from the browser storage", e);
            return undefined;
        }
    }
    writeInstallCard(record: InstallCardRecord): void {
        try {
            localStorage.setItem(installCardKey, JSON.stringify(record));
        } catch (e) {
            console.warn("Could not save the install state in the browser storage", e);
        }
    }
    clearInstallCard(): void {
        try {
            localStorage.removeItem(installCardKey);
            localStorage.removeItem(installCardSeenKey);
        } catch (e) {
            console.warn("Could not save the install state in the browser storage", e);
        }
    }

    private parseInstallCard(raw: string | null): InstallCardRecord | undefined {
        if (raw === null) return undefined;
        try {
            const parsed = isInstallCardRecord.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : undefined;
        } catch {
            return undefined;
        }
    }

    /** The install of the app was already counted on this device. */
    isInstallReported(): boolean {
        return this.readInstallFlag(installReportedKey);
    }
    markInstallReported(): void {
        this.writeInstallFlag(installReportedKey, true);
    }
    /** The browser offers the install again: the app was removed, so a new install counts again. */
    clearInstallReported(): void {
        this.writeInstallFlag(installReportedKey, false);
    }

    private readInstallFlag(key: string): boolean {
        try {
            return localStorage.getItem(key) === "true";
        } catch (e) {
            console.warn("Could not read the install state from the browser storage", e);
            return false;
        }
    }

    private writeInstallFlag(key: string, value: boolean): void {
        try {
            if (value) {
                localStorage.setItem(key, "true");
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) {
            console.warn("Could not save the install state in the browser storage", e);
        }
    }

    /** Whether a last room was ever saved here (otherwise getLastRoomUrl gives the start page). */
    hasLastRoomUrl(): boolean {
        return localStorage.getItem(lastRoomUrl) !== null;
    }

    getLastRoomUrl(): string {
        return localStorage.getItem(lastRoomUrl) ?? window.location.protocol + "//" + window.location.host + "/";
    }

    getLastRoomUrlCacheApi(): Promise<string | undefined> {
        if (!("caches" in window)) {
            return Promise.resolve(undefined);
        }
        return caches.open(cacheAPIIndex).then((cache) => {
            return cache.match(`/${lastRoomUrl}`).then((res) => {
                return res?.json().then((data) => {
                    return data.roomUrl;
                });
            });
        });
    }

    setAuthToken(value: string | null) {
        if (value !== null) {
            localStorage.setItem(authToken, value);
            this.jwt = JwtAuthToken.parse(LocalUserStore.parseJwt(value));
        } else {
            localStorage.removeItem(authToken);
        }
    }

    getAuthToken(): string | null {
        return localStorage.getItem(authToken);
    }

    /**
     * Before signing in, keeps the guest's own token aside (never an account's) so that, once signed in, the game can
     * tell Orbit which guest id this device used and the guest's visits join the account. Gone after one use, after
     * 30 minutes, on logout and when the device gets a new guest.
     */
    keepGuestTokenAside(now = Date.now()): void {
        const token = localStorage.getItem(authToken);
        if (!token || this.storedTokenIsAccounts()) return;
        localStorage.setItem(guestTokenAsideKey, JSON.stringify({ token, at: now }));
    }

    /** The guest token kept aside, without removing it. Null when there is none or it is too old. */
    peekGuestTokenAside(now = Date.now()): string | null {
        const raw = localStorage.getItem(guestTokenAsideKey);
        if (!raw) return null;
        try {
            const kept = z.object({ token: z.string().min(1), at: z.number().finite() }).parse(JSON.parse(raw));
            return now - kept.at <= GUEST_TOKEN_ASIDE_MS ? kept.token : null;
        } catch {
            return null;
        }
    }

    /** The guest token kept aside, once: asking removes it. */
    takeGuestTokenAside(now = Date.now()): string | null {
        const token = this.peekGuestTokenAside(now);
        this.dropGuestTokenAside();
        return token;
    }

    dropGuestTokenAside(): void {
        localStorage.removeItem(guestTokenAsideKey);
    }

    isLogged(): boolean {
        return this.jwt?.accessToken !== undefined && this.jwt?.accessToken !== null;
    }

    /**
     * Whether the token kept on this device was an account's, not a guest's. The page has not taken a stored token in
     * until the pusher accepts it, so this reads the device.
     */
    storedTokenIsAccounts(): boolean {
        const token = localStorage.getItem(authToken);
        if (!token) return false;
        try {
            const accessToken = JwtAuthToken.parse(LocalUserStore.parseJwt(token)).accessToken;
            return accessToken !== undefined && accessToken !== null;
        } catch {
            return false;
        }
    }

    private static parseJwt(token: string) {
        const base64Url = token.split(".")[1];
        const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
        const jsonPayload = decodeURIComponent(
            window
                .atob(base64)
                .split("")
                .map(function (c) {
                    return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
                })
                .join("")
        );

        return JSON.parse(jsonPayload);
    }

    setNotification(value: boolean): void {
        localStorage.setItem(notification, value.toString());
    }

    getNotification(): boolean {
        return localStorage.getItem(notification) === "true";
    }

    /** This browser's id in Your devices once Orbit saved it (#863), so it is known even while switched off. */
    getPushDeviceId(): string | null {
        try {
            return localStorage.getItem("pushDeviceId");
        } catch (e) {
            console.warn("Could not read the saved device id", e);
            return null;
        }
    }

    setPushDeviceId(id: string | null): void {
        try {
            if (id === null) localStorage.removeItem("pushDeviceId");
            else localStorage.setItem("pushDeviceId", id);
        } catch (e) {
            console.warn("Could not save the device id", e);
        }
    }

    /** Whether notifications were switched on or off here; null when that was never set. */
    getNotificationChoice(): boolean | null {
        const value = localStorage.getItem(notification);
        return value === null ? null : value === "true";
    }

    setAllowPictureInPicture(value: boolean): void {
        localStorage.setItem(allowPictureInPicture, value.toString());
    }

    getAllowPictureInPicture(): boolean {
        return localStorage.getItem(allowPictureInPicture) !== "false";
    }

    setChatSounds(value: boolean): void {
        localStorage.setItem(chatSounds, value.toString());
    }

    getChatSounds(): boolean {
        return localStorage.getItem(chatSounds) !== "false";
    }

    private getFoldersOpened(): Set<string> {
        const foldersStr = localStorage.getItem(foldersOpened);
        if (!foldersStr) {
            return new Set<string>();
        }
        try {
            const parsed = FoldersOpenedSchema.parse(JSON.parse(foldersStr));
            return parsed ?? new Set<string>();
        } catch (e) {
            console.warn("Error parsing folders opened from localStorage:", e);
            localStorage.removeItem(foldersOpened);
            return new Set<string>();
        }
    }

    private setFoldersOpened(folders: Set<string>) {
        localStorage.setItem(foldersOpened, JSON.stringify(Array.from(folders)));
    }

    hasFolderOpened(folderId: string): boolean {
        return this.getFoldersOpened().has(folderId);
    }

    addFolderOpened(folderId: string) {
        const folders = this.getFoldersOpened();
        folders.add(folderId);
        this.setFoldersOpened(folders);
    }

    removeFolderOpened(folderId: string) {
        const folders = this.getFoldersOpened();
        folders.delete(folderId);
        this.setFoldersOpened(folders);
    }

    /**
     * Media devices this browser has already seen, as "kind:label" keys (see NewMediaDevices.ts).
     */
    getKnownMediaDevices(): string[] {
        const stored = localStorage.getItem(knownMediaDevices);
        if (!stored) {
            return [];
        }
        try {
            return KnownMediaDevicesSchema.parse(JSON.parse(stored));
        } catch (e) {
            console.warn("Error parsing known media devices from localStorage:", e);
            localStorage.removeItem(knownMediaDevices);
            return [];
        }
    }

    setKnownMediaDevices(keys: string[]) {
        try {
            localStorage.setItem(knownMediaDevices, JSON.stringify(keys));
        } catch (e) {
            // A full or blocked storage must not stop the device list from updating.
            console.warn("Error saving known media devices to localStorage:", e);
        }
    }

    /**
     * Device names the player asked never to be offered again ("Don't ask for this device"), see NewMediaDevices.ts.
     */
    getIgnoredNewMediaDevices(): string[] {
        const stored = localStorage.getItem(ignoredNewMediaDevices);
        if (!stored) {
            return [];
        }
        try {
            return KnownMediaDevicesSchema.parse(JSON.parse(stored));
        } catch (e) {
            console.warn("Error parsing ignored media devices from localStorage:", e);
            localStorage.removeItem(ignoredNewMediaDevices);
            return [];
        }
    }

    addIgnoredNewMediaDevices(keys: string[]) {
        // Most recent last, and bounded like the known devices.
        const kept = this.getIgnoredNewMediaDevices().filter((key) => !keys.includes(key));
        try {
            localStorage.setItem(ignoredNewMediaDevices, JSON.stringify([...kept, ...keys].slice(-100)));
        } catch (e) {
            console.warn("Error saving ignored media devices to localStorage:", e);
        }
    }

    setPreferredVideoInputDevice(deviceId?: string) {
        if (deviceId === undefined) {
            localStorage.removeItem(preferredVideoInputDevice);
            return;
        }

        localStorage.setItem(preferredVideoInputDevice, deviceId);
    }

    setPreferredAudioInputDevice(deviceId?: string) {
        if (deviceId === undefined) {
            localStorage.removeItem(preferredAudioInputDevice);
            return;
        }

        localStorage.setItem(preferredAudioInputDevice, deviceId);
    }

    getPreferredVideoInputDevice(): string | undefined {
        const deviceId = localStorage.getItem(preferredVideoInputDevice);

        if (deviceId === null) {
            return undefined;
        }

        return deviceId;
    }

    getPreferredAudioInputDevice(): string | undefined {
        const deviceId = localStorage.getItem(preferredAudioInputDevice);

        if (deviceId === null) {
            return undefined;
        }

        return deviceId;
    }

    /** The "Drag to look around" hint has been seen: it goes after the first real drag. */
    setLookAroundHintSeen(value: boolean): void {
        localStorage.setItem(lookAroundHintSeenKey, value.toString());
    }

    getLookAroundHintSeen(): boolean {
        return localStorage.getItem(lookAroundHintSeenKey) === "true";
    }

    /** The "Pick a tool on the right" hint of the room editor has been seen (a tool was picked once). */
    setEditHintSeen(value: boolean): void {
        localStorage.setItem(editHintSeenKey, value.toString());
    }

    getEditHintSeen(): boolean {
        return localStorage.getItem(editHintSeenKey) === "true";
    }

    /** The objects placed most recently in the room editor, newest first, by prefab id. */
    setRecentEditObjects(ids: string[]): void {
        localStorage.setItem(recentEditObjectsKey, JSON.stringify(ids));
    }

    getRecentEditObjects(): string[] {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(recentEditObjectsKey) ?? "[]");
            return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
        } catch {
            return [];
        }
    }

    setCameraPrivacySettings(option: boolean) {
        localStorage.setItem(cameraPrivacySettings, option.toString());
    }

    getCameraPrivacySettings() {
        //if this setting doesn't exist in LocalUserStore, we set a default value
        if (localStorage.getItem(cameraPrivacySettings) == null) {
            localStorage.setItem(cameraPrivacySettings, "false");
        }
        return localStorage.getItem(cameraPrivacySettings) === "true";
    }

    private isPhone(): boolean {
        return isIOS() || isAndroid();
    }

    setMicrophonePrivacySettings(option: boolean) {
        localStorage.setItem(
            this.isPhone() ? phoneMicrophonePrivacySettings : microphonePrivacySettings,
            option.toString()
        );
    }

    getMicrophonePrivacySettings() {
        const key = this.isPhone() ? phoneMicrophonePrivacySettings : microphonePrivacySettings;
        //if this setting doesn't exist in LocalUserStore, we set a default value
        if (localStorage.getItem(key) == null) {
            localStorage.setItem(key, this.isPhone() ? "false" : "true");
        }
        return localStorage.getItem(key) === "true";
    }

    getAllUserProperties(context: string): Map<string, PlayerVariable> {
        const now = new Date().getTime();
        const result = new Map<string, PlayerVariable>();
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key) {
                if (key.startsWith(userProperties + "_" + context + "__|__")) {
                    const storedValue = localStorage.getItem(key);
                    if (storedValue) {
                        const userKey = key.substring((userProperties + "_" + context + "__|__").length);

                        const [expireStr, isPublicStr] = storedValue.split(":", 2);
                        const value = storedValue.split(":").slice(2).join(":");
                        if (isPublicStr === undefined || value === undefined) {
                            console.error(
                                'Invalid value stored in Redis. Expecting the value to be in the "ttl:0|1:value" format. Got: ',
                                storedValue
                            );
                            continue;
                        }
                        let isPublic: boolean;
                        if (isPublicStr === "0") {
                            isPublic = false;
                        } else if (isPublicStr === "1") {
                            isPublic = true;
                        } else {
                            console.error('Invalid value stored in Redis for isPublic. Expecting "0" or "1"');
                            continue;
                        }
                        let expire: number | undefined;
                        if (expireStr === "") {
                            expire = undefined;
                        } else {
                            expire = parseInt(expireStr);
                            if (isNaN(expire)) {
                                console.error("Invalid value stored in Redis. The TTL is not a number");
                                continue;
                            }

                            // Let's check the TTL. If it is less than current date, let's remove the key.
                            if (expire < now) {
                                localStorage.removeItem(key);
                                continue;
                            }
                        }

                        let valueReturned;
                        try {
                            valueReturned = JSON.parse(value);
                        } catch (err) {
                            console.info(
                                "getAllUserProperties => value cannot be parsed to JSON, undefined returned.",
                                err
                            );
                            valueReturned = undefined;
                        }
                        result.set(userKey, {
                            isPublic,
                            value: valueReturned,
                        });
                    }
                }
            }
        }
        return result;
    }

    setUserProperty(
        name: string,
        value: unknown,
        context: string,
        isPublic: boolean,
        expire: number | undefined
    ): void {
        const key = userProperties + "_" + context + "__|__" + name;

        if (value === undefined) {
            localStorage.removeItem(key);
            return;
        }

        const storedValue =
            (expire !== undefined ? expire : "") + ":" + (isPublic ? "1" : "0") + ":" + JSON.stringify(value);

        localStorage.setItem(key, storedValue);
    }

    setEmojiFavorite(value: Map<number, Emoji>) {
        const valueToSave: Array<Emoji> = new Array<Emoji>();
        for (const data of value.values()) {
            valueToSave.push(data);
        }
        localStorage.setItem(emojiFavorite, JSON.stringify(valueToSave));
    }
    getEmojiFavorite(): Map<number, Emoji> | null {
        const value = localStorage.getItem(emojiFavorite);
        if (value == undefined) return null;
        try {
            const emojis: Emoji[] = JSON.parse(value);
            arrayEmoji.parse(emojis);
            const map = new Map<number, Emoji>();
            emojis.forEach((value, index) => {
                map.set(index + 1, value);
            });
            return map;
        } catch (e) {
            localStorage.removeItem(emojiFavorite);
            console.error("The localStorage key 'emojiFavorite' format is incorrect:", e);
            return null;
        }
    }

    setQuickPhrases(value: QuickPhrase[]) {
        localStorage.setItem(quickPhrases, JSON.stringify(value));
    }
    getQuickPhrases(): QuickPhrase[] | null {
        const value = localStorage.getItem(quickPhrases);
        if (value == undefined) return null;
        try {
            return arrayQuickPhrase.parse(JSON.parse(value));
        } catch (e) {
            localStorage.removeItem(quickPhrases);
            console.error("The localStorage key 'quickPhrases' format is incorrect:", e);
            return null;
        }
    }

    setSpeakerDeviceId(value: string) {
        localStorage.setItem(speakerDeviceId, value);
    }

    getSpeakerDeviceId() {
        return localStorage.getItem(speakerDeviceId);
    }

    setVideoBandwidth(value: number | "unlimited") {
        localStorage.setItem("videoBandwidth", value.toString());
    }

    getVideoBandwidth(): number | "unlimited" {
        const value = localStorage.getItem("videoBandwidth");

        if (!value) {
            return PEER_VIDEO_RECOMMENDED_BANDWIDTH;
        }

        if (value === "unlimited") {
            return value;
        }

        return parseInt(value);
    }

    setScreenShareBandwidth(value: number | "unlimited") {
        localStorage.setItem("screenShareBandwidth", value.toString());
    }

    getScreenShareBandwidth(): number | "unlimited" {
        const value = localStorage.getItem("screenShareBandwidth");

        if (!value) {
            return PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH;
        }

        if (value === "unlimited") {
            return value;
        }

        return parseInt(value);
    }

    // Microphone noise filter: "standard" (browser), "strong" (on-device model) or "voiceOnly" (browser voice isolation)
    setNoiseFilter(value: string) {
        localStorage.setItem("noiseFilter", value);
    }

    getNoiseFilter(): string | null {
        return localStorage.getItem("noiseFilter");
    }

    // Background transformation settings
    setBackgroundMode(value: string) {
        localStorage.setItem("backgroundMode", value);
    }

    getBackgroundMode(): string | null {
        return localStorage.getItem("backgroundMode");
    }

    setBackgroundBlurAmount(value: number) {
        localStorage.setItem("backgroundBlurAmount", value.toString());
    }

    getBackgroundBlurAmount(): number | null {
        const value = localStorage.getItem("backgroundBlurAmount");
        return value ? parseInt(value) : null;
    }

    setBackgroundImage(value: string) {
        localStorage.setItem("backgroundImage", value);
    }

    getBackgroundImage(): string | null {
        return localStorage.getItem("backgroundImage");
    }

    getRequestedStatus(): RequestedStatus | null {
        return requestedStatusFactory.createRequestedStatus(localStorage.getItem(requestedStatus));
    }

    setRequestedStatus(newStatus: RequestedStatus | null) {
        localStorage.setItem(requestedStatus, String(newStatus));
    }

    getLastNotificationPermissionRequest(): string | null {
        return localStorage.getItem("lastNotificationPermissionRequest");
    }
    setLastNotificationPermissionRequest() {
        localStorage.setItem("lastNotificationPermissionRequest", new Date().toString());
    }

    setMatrixUserId(value: string | null) {
        if (value !== null) {
            localStorage.setItem(matrixUserId, value);
        } else {
            localStorage.removeItem(matrixUserId);
        }
    }

    getMatrixUserId(): string | null {
        return localStorage.getItem(matrixUserId);
    }

    setMatrixAccessToken(value: string | null) {
        if (value !== null) {
            localStorage.setItem(matrixAccessToken, value);
        } else {
            localStorage.removeItem(matrixAccessToken);
        }
    }

    getMatrixAccessToken(): string | null {
        return localStorage.getItem(matrixAccessToken);
    }

    setMatrixAccessTokenExpireDate(value: Date | null) {
        if (value !== null) {
            localStorage.setItem(matrixAccessTokenExpireDate, value.toString());
        } else {
            localStorage.removeItem(matrixAccessTokenExpireDate);
        }
    }

    getMatrixAccessTokenExpireDate(): Date | null {
        const value = localStorage.getItem(matrixAccessTokenExpireDate);
        if (value === null) {
            return null;
        }
        return new Date(value);
    }

    setMatrixRefreshToken(value: string | null) {
        if (value !== null) {
            localStorage.setItem(matrixRefreshToken, value);
        } else {
            localStorage.removeItem(matrixRefreshToken);
        }
    }

    getMatrixRefreshToken(): string | null {
        return localStorage.getItem(matrixRefreshToken);
    }

    setMatrixDeviceId(value: string | null, userUuid: string) {
        if (value !== null) {
            localStorage.setItem(matrixDeviceId + "_" + userUuid, value);
        } else {
            localStorage.removeItem(matrixDeviceId + "_" + userUuid);
        }
    }

    getMatrixDeviceId(userUuid: string): string | null {
        return localStorage.getItem(matrixDeviceId + "_" + userUuid) ?? "";
    }

    setMatrixLoginToken(value: string | null) {
        if (value !== null) {
            localStorage.setItem(matrixLoginToken, value);
        } else {
            localStorage.removeItem(matrixLoginToken);
        }
    }

    getMatrixLoginToken() {
        return localStorage.getItem(matrixLoginToken);
    }

    //TODO : Remove duplicate code (getMatrixUserId) and change matrix id to chatID in localStorage
    getChatId(): string | null {
        return localStorage.getItem(matrixUserId);
    }

    isGuest(): boolean {
        return localStorage.getItem(matrixGuest) === "true";
    }

    setGuest(isGuest: boolean): void {
        localStorage.setItem(matrixGuest, isGuest.toString());
    }

    getVolumeProximityDiscussion(): number {
        return parseFloat(localStorage.getItem(volumeProximityDiscussion) || "1");
    }

    setVolumeProximityDiscussion(value: number): void {
        localStorage.setItem(volumeProximityDiscussion, `${value}`);
    }

    setCameraContainerHeight(ratio: number): void {
        localStorage.setItem(cameraContainerHeightKey, ratio.toString());
    }

    getCameraContainerHeight(): number {
        const value = localStorage.getItem(cameraContainerHeightKey);
        if (!value) {
            return 0.2; // Default value of 20%
        }
        return parseFloat(value);
    }

    setChatSideBarWidth(width: number): void {
        localStorage.setItem(chatSideBarWidthKey, width.toString());
    }

    getChatSideBarWidth(): number {
        const value = localStorage.getItem(chatSideBarWidthKey);
        if (!value) {
            return INITIAL_SIDEBAR_WIDTH;
        }
        const floatValue = parseFloat(value);
        return isNaN(floatValue) ? INITIAL_SIDEBAR_WIDTH : floatValue;
    }

    setMapEditorSideBarWidth(width: number): void {
        localStorage.setItem(mapEditorSideBarWidthKey, width.toString());
    }

    getMapEditorSideBarWidth(): number {
        const value = localStorage.getItem(mapEditorSideBarWidthKey);
        if (!value) {
            return INITIAL_MAP_EDITOR_SIDEBAR_WIDTH;
        }
        const floatValue = parseFloat(value);
        return isNaN(floatValue) ? INITIAL_MAP_EDITOR_SIDEBAR_WIDTH : floatValue;
    }

    setBubbleSound(value: "ding" | "wobble"): void {
        localStorage.setItem(bubbleSound, value);
    }

    getBubbleSound(): "ding" | "wobble" {
        const value = localStorage.getItem(bubbleSound);
        if (value === "wobble") {
            return "wobble";
        }
        return "ding";
    }
}

export const localUserStore = new LocalUserStore();
