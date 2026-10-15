import type { Readable, Writable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { SetPlayerVariableEvent } from "../Api/Events/SetPlayerVariableEvent";
import type { InstallEnvironment, InstallGuide } from "./InstallPlatform";
import { browserMenuGuideFor, installGuideFor, isInstalledApp } from "./InstallPlatform";

/** After this long in a room, with no conversation yet, the card may show. */
export const FIRST_MOMENT_MS = 5000;
/** After it showed, the card may show again once this has passed. */
export const CARD_GAP_MS = 24 * 60 * 60 * 1000;
/** After this many closes in a row (✕, or the browser's window cancelled), the gap is the long one. */
export const CLOSES_BEFORE_LONG_GAP = 3;
export const LONG_CARD_GAP_MS = 7 * CARD_GAP_MS;
/** The player variable that tells an Apple browser, which cannot see the app, that this account installed it. */
export const APP_INSTALLED_VARIABLE = "universeAppInstalled";
/** How long "Universe is on your home screen" stays. */
export const INSTALLED_TOAST_MS = 4000;

/** Where the player asked to install from. "browser" is an install made from the browser's own menu. */
export type InstallSource = "card" | "menu" | "browser" | "app";

/** Chrome, Edge and the Android browsers hand the game this to open their own install window. */
export interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** What the card remembers on this device. */
export interface InstallCardRecord {
    /** When the card last showed (ms since 1970). */
    lastShownAt: number;
    /** How many times in a row the card was closed (✕, or the browser's window cancelled). */
    closeStreak: number;
    /** The last showing was closed. When it was not, it was ignored, and the streak starts again at the next showing. */
    lastClosed: boolean;
}

export interface InstallStorage {
    readCardRecord(): InstallCardRecord | undefined;
    writeCardRecord(record: InstallCardRecord): void;
    clearCardRecord(): void;
    /** The install was already counted on this device. */
    isInstallReported(): boolean;
    markInstallReported(): void;
    /** Forget that the app was installed (the browser offers the install again, so it is gone). */
    clearInstallReported(): void;
}

/** What navigator.getInstalledRelatedApps gives: the apps of our own manifest that are installed. */
export type InstalledAppsLookup = () => Promise<readonly unknown[]>;

export interface InstallAnalytics {
    cardShown(): void;
    cardDismissed(): void;
    installed(source: InstallSource): void;
}

export interface InstallAppOptions {
    env: InstallEnvironment;
    /**
     * True while nothing else has the player's attention: no conversation, call, chat, broadcast, map editor or open
     * menu. The card shows only then.
     */
    quiet: Readable<boolean>;
    storage: InstallStorage;
    analytics: InstallAnalytics;
    /** The time, in ms since 1970. Tests set it. */
    now?: () => number;
}

/** The player of this account, for the app's mark on the account. */
export interface InstallAccount {
    isLogged(): boolean;
    setVariable(event: SetPlayerVariableEvent): void;
}

/**
 * Installing Universe as an app, from the first moment to the home screen.
 *
 * Nothing here ever blocks the way into the room: the card is a small note that shows now and then (a day after it
 * last showed, a week after three closes in a row), the menu row is always there until the app is installed, and
 * everything is gone inside the installed app.
 */
export class InstallApp {
    /** The guide this browser needs (iPhone, iPad, Mac Safari), if any. */
    public readonly guide: InstallGuide | undefined;
    /** The guide that is open, or undefined. */
    public readonly guideOpenStore = writable<InstallGuide | undefined>(undefined);
    /** "Universe is on your home screen" is showing. */
    public readonly installedToastStore = writable(false);
    /** The "Install app" row of the profile menu shows, and installing is possible from here. */
    public readonly canInstallStore: Readable<boolean>;
    /** The card is on screen. */
    public readonly cardVisibleStore: Readable<boolean>;

    private readonly installedHere: boolean;
    /** The browser's install window was opened and cancelled: it cannot open twice, so the row points at the browser's menu. */
    private readonly promptSpentStore = writable(false);
    private readonly promptStore = writable<BeforeInstallPromptEvent | undefined>(undefined);
    private readonly installedStore: Writable<boolean>;
    private readonly firstMomentStore = writable(false);
    private readonly cardShownStore = writable(false);
    /** This account has the app (an Apple browser cannot see that itself): no card on this load. */
    private readonly appOnAccountStore = writable(false);
    private readonly now: () => number;
    /** The card showed or was closed on this load: it does not come again before the next load. */
    private cardDone = false;
    private closeCounted = false;
    private testLink = false;
    private firstMomentTimer: ReturnType<typeof setTimeout> | undefined;
    private toastTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly options: InstallAppOptions) {
        const { env, quiet, storage, analytics } = options;
        this.now = options.now ?? Date.now;
        this.installedHere = isInstalledApp(env);
        this.guide = this.installedHere ? undefined : installGuideFor(env);
        // Chrome, Edge and Android remember an install made from here. Apple's browsers cannot tell (no event, and
        // the Home Screen app keeps its own storage), so for them the row stays.
        const installedBefore = this.guide === undefined && storage.isInstallReported();
        this.installedStore = writable(this.installedHere || installedBefore);

        // Chrome and Edge only say "installable" with their event; Apple's browsers are always installable by hand.
        this.canInstallStore = derived(
            [this.installedStore, this.promptStore, this.promptSpentStore],
            ([installed, prompt, spent]) => !installed && (prompt !== undefined || spent || this.guide !== undefined)
        );

        const ready = derived(
            [this.canInstallStore, this.firstMomentStore, quiet, this.appOnAccountStore],
            ([canInstall, firstMoment, isQuiet, onAccount]) => canInstall && firstMoment && isQuiet && !onAccount
        );
        // Counted and remembered the moment it shows, so a reload does not bring it back before its gap has passed.
        // The subscription lives as long as the game does.
        // eslint-disable-next-line svelte/no-ignored-unsubscribe
        ready.subscribe((isReady) => {
            if (isReady && !this.cardDone && this.cardIsDue()) this.showCard();
        });
        // It waits out a call, the chat or a menu, and comes back when they end.
        this.cardVisibleStore = derived(
            [this.cardShownStore, this.canInstallStore, quiet, this.appOnAccountStore],
            ([shown, canInstall, isQuiet, onAccount]) => shown && canInstall && isQuiet && !onAccount
        );

        // An app already installed and opened here is counted once, on the device that holds its own storage (iPhone).
        if (this.installedHere && !storage.isInstallReported()) {
            storage.markInstallReported();
            analytics.installed("app");
        }
    }

    /**
     * Listens for the browser's install event. Called once, as early as possible: the event comes only once.
     * Returns what stops listening.
     */
    public start(
        target: Pick<Window, "addEventListener" | "removeEventListener">,
        installedApps?: InstalledAppsLookup
    ): () => void {
        const onBeforeInstallPrompt = (event: Event) => {
            // The browser's own mini bar would come before our card: we choose the moment.
            event.preventDefault();
            this.promptStore.set(event as BeforeInstallPromptEvent);
            this.promptSpentStore.set(false);
            // The browser only offers the install when the app is not installed: if it was removed, the row is back.
            if (!this.installedHere && get(this.installedStore)) {
                this.options.storage.clearInstallReported();
                this.installedStore.set(false);
            }
        };
        const onAppInstalled = () => this.markInstalled("browser");
        target.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        target.addEventListener("appinstalled", onAppInstalled);
        // Installed earlier (from another tab, or before this device remembered it): the browser knows, if it can say.
        // Best effort: where it cannot, the row simply stays until the first install here.
        if (installedApps !== undefined && this.guide === undefined) {
            installedApps()
                .then((apps) => {
                    if (apps.length > 0 && get(this.promptStore) === undefined) this.markAlreadyInstalled();
                })
                .catch(() => undefined);
        }
        return () => {
            target.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
            target.removeEventListener("appinstalled", onAppInstalled);
        };
    }

    /**
     * The test link (?installCard=show): forget what the card remembers and show it as soon as the player is in a room
     * (not over the loading or login screen), where it can show.
     */
    public showForTestLink(): void {
        this.testLink = true;
        this.options.storage.clearCardRecord();
    }

    /** The player is in a room. After a few seconds there, the card may show even with no conversation. */
    public noteInRoom(): void {
        if (get(this.firstMomentStore) || this.firstMomentTimer !== undefined) return;
        if (this.testLink) {
            this.firstMomentStore.set(true);
            return;
        }
        if (get(this.installedStore) || !this.cardIsDue()) return;
        this.firstMomentTimer = setTimeout(() => this.firstMomentStore.set(true), FIRST_MOMENT_MS);
    }

    /** A conversation just ended: a good moment for the card. */
    public noteConversationEnded(): void {
        clearTimeout(this.firstMomentTimer);
        this.firstMomentStore.set(true);
    }

    /**
     * The room was joined, with the player variables of this account. Inside the installed app, a logged in player
     * marks the world, in each world the app enters that has no mark yet: the mark is kept per world, not per account
     * (#1024). In an Apple browser, which cannot see the app, the mark tells the card to stay away. Chrome and Edge
     * see the app themselves.
     */
    public noteRoomJoined(variables: ReadonlyMap<string, unknown>, account: InstallAccount): void {
        if (this.installedHere) {
            if (variables.get(APP_INSTALLED_VARIABLE) === true || !account.isLogged()) return;
            account.setVariable({
                key: APP_INSTALLED_VARIABLE,
                value: true,
                public: false,
                persist: true,
                scope: "world",
            });
        } else if (this.guide !== undefined && variables.get(APP_INSTALLED_VARIABLE) === true) {
            this.noteAppOnAccount();
        }
    }

    /** This account has the app installed: no card on this load (the menu row stays, in case the app was deleted). */
    public noteAppOnAccount(): void {
        if (this.testLink || this.guide === undefined) return;
        this.appOnAccountStore.set(true);
    }

    /** The ✕ of the card: it comes back later. */
    public dismissCard(): void {
        if (!get(this.cardShownStore)) return;
        this.cardShownStore.set(false);
        this.countClose();
        this.options.analytics.cardDismissed();
    }

    /** Install, from the card or the menu: the browser's own window where there is one, else the guide. */
    public async install(source: Extract<InstallSource, "card" | "menu">): Promise<void> {
        // The player is deciding now, from the card or the menu: the card has done its job either way.
        this.cardShownStore.set(false);
        const prompt = get(this.promptStore);
        if (prompt !== undefined) {
            // The event opens the window once; the browser sends a new one if it offers again.
            this.promptStore.set(undefined);
            try {
                await prompt.prompt();
                const choice = await prompt.userChoice;
                if (choice.outcome === "accepted") this.markInstalled(source);
                // Cancelled: the window cannot open again, so the row stays and points at the browser's own menu.
                else this.markPromptSpent();
            } catch (error) {
                console.warn("The browser could not open its install window", error);
                this.markPromptSpent();
            }
            return;
        }
        if (this.guide !== undefined) {
            this.guideOpenStore.set(this.guide);
        } else if (get(this.promptSpentStore)) {
            this.guideOpenStore.set(browserMenuGuideFor(this.options.env));
        }
    }

    public closeGuide(): void {
        this.guideOpenStore.set(undefined);
    }

    /** The player has seen the browser's own window, so that counts as closing the card. */
    private markPromptSpent(): void {
        this.promptSpentStore.set(true);
        this.countClose();
    }

    /** The card may show: never, or its gap has passed since it last showed. */
    private cardIsDue(): boolean {
        const record = this.options.storage.readCardRecord();
        if (record === undefined) return true;
        const gap = record.lastClosed && record.closeStreak >= CLOSES_BEFORE_LONG_GAP ? LONG_CARD_GAP_MS : CARD_GAP_MS;
        return this.now() - record.lastShownAt >= gap;
    }

    private showCard(): void {
        const { storage, analytics } = this.options;
        const record = storage.readCardRecord();
        this.cardDone = true;
        // A showing that was ignored breaks the row of closes.
        const closeStreak = record?.lastClosed === true ? record.closeStreak : 0;
        storage.writeCardRecord({ lastShownAt: this.now(), closeStreak, lastClosed: false });
        this.cardShownStore.set(true);
        analytics.cardShown();
    }

    /**
     * The card was closed: with ✕, or by cancelling the browser's window (from the card or the menu). Counts once per
     * showing. Cancelled from the menu with no card shown on this load, it also counts as a showing: the card waits
     * its gap.
     */
    private countClose(): void {
        if (this.closeCounted) return;
        this.closeCounted = true;
        const { storage } = this.options;
        const record = storage.readCardRecord();
        const shownOnThisLoad = this.cardDone;
        this.cardDone = true;
        const streak = shownOnThisLoad || record?.lastClosed === true ? record?.closeStreak ?? 0 : 0;
        storage.writeCardRecord({
            lastShownAt: shownOnThisLoad ? record?.lastShownAt ?? this.now() : this.now(),
            closeStreak: streak + 1,
            lastClosed: true,
        });
    }

    /** The app is installed already: step aside, with no toast and no new count. */
    private markAlreadyInstalled(): void {
        this.installedStore.set(true);
        this.cardShownStore.set(false);
        this.options.storage.markInstallReported();
    }

    private markInstalled(source: InstallSource): void {
        if (get(this.installedStore)) return;
        this.installedStore.set(true);
        this.cardShownStore.set(false);
        this.guideOpenStore.set(undefined);
        this.promptSpentStore.set(false);
        this.options.storage.markInstallReported();
        this.options.analytics.installed(source);
        this.installedToastStore.set(true);
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => this.installedToastStore.set(false), INSTALLED_TOAST_MS);
    }
}
