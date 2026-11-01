/**
 * The voice bots in the bubble or meeting we are in (#1666), and where the voice of the first one stands.
 *
 * A space with media (a bubble, a meeting room) is watched while we are in it (trackVoiceSpace). A bot is a voice bot
 * when its token says so or when it sends us a voice status; the status event is trusted only from a bot about
 * itself (the pusher refuses anything else, and this checks again). Each status moves the bot between connecting,
 * on and paused. The first time a bot's status arrives, and each time it starts connecting again, our saved choice
 * is sent to it, and again whenever the choice changes: the bot (and its voice worker) enforce it.
 *
 * Two voice bots in one bubble: only the first one gets the button (two voice bots answering is a later issue, #1670).
 */
import type { Readable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { Subscription } from "rxjs";
import { isAreaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import { localUserStore } from "../../Connection/LocalUserStore";
import type { SpaceInterface, SpaceUserExtended } from "../../Space/SpaceInterface";
import { blackListManager } from "../../WebRtc/BlackListManager";
import { audioContextManager } from "../../WebRtc/AudioContextManager";
import {
    choiceHearsBot,
    parseBotVoiceStatus,
    voiceModeOf,
    type BotVoiceStatus,
    type VoiceBotState,
    type VoiceChoice,
} from "./VoiceMode";

/** The tag a voice bot's token carries next to "bot" (bots/voice/VoiceBotTag.ts). */
const VOICE_BOT_TAG = "voice-bot";

const isBot = (user: { tags?: string[]; uuid?: string }): boolean =>
    (user.tags?.includes("bot") ?? false) || (user.uuid?.startsWith("bot-") ?? false);

// ---- the person's choice ----

function createVoiceChoiceStore() {
    const { subscribe, set } = writable<VoiceChoice>(localUserStore.getVoiceChoice());
    return {
        subscribe,
        /** Saved for this person, and sent to every voice bot they are with. */
        choose(choice: VoiceChoice): void {
            localUserStore.setVoiceChoice(choice);
            set(choice);
        },
    };
}

export const voiceChoiceStore = createVoiceChoiceStore();

// ---- what is shown ----

export interface VoiceBotView {
    spaceUserId: string;
    /** The bot's id, as it names itself in its status ("bot-" and this make its uuid). */
    botId: string;
    name: string;
    picture: Readable<string | undefined>;
    state: VoiceBotState;
    /** Seconds the bot keeps listening without its name after it answers; 0: the bot says none. */
    followUpSeconds: number;
}

export interface VoiceSpaceView {
    /** A meeting room or a stage's space, not a bubble. */
    meeting: boolean;
    /** The first voice bot here: the only one the button is for. */
    bot: VoiceBotView | undefined;
    /** Every voice bot here, so the sound of each can be told apart from other people's. */
    botSpaceUserIds: string[];
    /** Everyone in the space, bots and us included. */
    people: number;
    /** Another real person is here with us. */
    othersPresent: boolean;
}

type ViewUser = Pick<SpaceUserExtended, "spaceUserId" | "uuid" | "tags" | "name" | "pictureStore">;

/** What the button and the menu need from who is in a space and what the bots said (pure, so it is tested alone). */
export function computeVoiceView(
    users: Iterable<ViewUser>,
    mySpaceUserId: string,
    statuses: ReadonlyMap<string, BotVoiceStatus>,
    meeting: boolean
): VoiceSpaceView {
    const bots: VoiceBotView[] = [];
    let people = 0;
    let othersPresent = false;
    let meIncluded = false;
    for (const user of users) {
        people++;
        if (user.spaceUserId === mySpaceUserId) {
            meIncluded = true;
            continue;
        }
        if (!isBot(user)) {
            othersPresent = true;
            continue;
        }
        const status = statuses.get(user.spaceUserId);
        if (!status && !user.tags?.includes(VOICE_BOT_TAG)) continue;
        bots.push({
            spaceUserId: user.spaceUserId,
            botId: status?.botId ?? (user.uuid ?? "").replace(/^bot-/, ""),
            name: status?.botName || user.name,
            picture: user.pictureStore,
            // Until the bot says, its voice is on its way
            state: status?.state ?? "connecting",
            followUpSeconds: status?.followUpSeconds ?? 0,
        });
    }
    if (!meIncluded) people++;
    return { meeting, bot: bots[0], botSpaceUserIds: bots.map((bot) => bot.spaceUserId), people, othersPresent };
}

const views = writable<ReadonlyMap<SpaceInterface, VoiceSpaceView>>(new Map());

/** The space whose first voice bot the button is for: the first one we are in with one. */
export const currentVoiceSpaceStore: Readable<VoiceSpaceView | undefined> = derived(views, ($views) => {
    for (const view of $views.values()) if (view.bot) return view;
    return undefined;
});

/** Everyone's voice bots, by space user id: how the game tells a bot's sound from a person's. */
export const voiceBotSpaceUserIdsStore: Readable<ReadonlySet<string>> = derived(views, ($views) => {
    const ids = new Set<string>();
    for (const view of $views.values()) for (const id of view.botSpaceUserIds) ids.add(id);
    return ids;
});

/** The voice bots whose sound does not play for us: our choice is not to hear them. */
export const silencedVoiceBotsStore: Readable<ReadonlySet<string>> = derived(
    [voiceBotSpaceUserIdsStore, voiceChoiceStore],
    ([$ids, $choice]) => (choiceHearsBot($choice) ? new Set<string>() : $ids)
);

// ---- following a space ----

class VoiceSpaceWatcher {
    private readonly statuses = new Map<string, BotVoiceStatus>();
    private latest: ReadonlyMap<string, ViewUser> = new Map();
    private readonly subscriptions: Subscription[] = [];
    private readonly unsubscribers: (() => void)[] = [];
    private destroyed = false;

    constructor(private readonly space: SpaceInterface) {
        this.unsubscribers.push(
            space.usersStore.subscribe((users) => {
                this.latest = users;
                // A bot that left no longer has a status
                for (const id of [...this.statuses.keys()]) if (!users.has(id)) this.statuses.delete(id);
                this.publish();
            })
        );
        this.subscriptions.push(
            space.observePrivateEvent("botVoiceStatus").subscribe((event) => {
                // Only a bot about itself; one this person blocked shows nothing, as with its messages
                if (!isBot(event.sender) || event.sender.uuid !== `bot-${event.botVoiceStatus.botId}`) return;
                if (blackListManager.isBlackListed(event.sender.uuid)) return;
                const status = parseBotVoiceStatus(event.botVoiceStatus, event.sender.name);
                if (status) this.onStatus(event.sender.spaceUserId, status);
            })
        );
        this.unsubscribers.push(voiceChoiceStore.subscribe(() => this.sendChoiceToBots()));
    }

    private onStatus(botSpaceUserId: string, status: BotVoiceStatus): void {
        const before = this.statuses.get(botSpaceUserId);
        this.statuses.set(botSpaceUserId, status);
        this.publish();
        // The bot learns our choice when it first speaks to us, and when it starts a new connection
        if (!before || (before.state !== "connecting" && status.state === "connecting")) {
            this.sendChoice(botSpaceUserId);
        }
    }

    private sendChoiceToBots(): void {
        for (const id of this.statuses.keys()) this.sendChoice(id);
    }

    private sendChoice(botSpaceUserId: string): void {
        if (this.destroyed || this.space.destroyed) return;
        this.space.emitPrivateMessage(
            { $case: "voiceModeChoice", voiceModeChoice: { mode: voiceModeOf(get(voiceChoiceStore)) } },
            botSpaceUserId
        );
    }

    private publish(): void {
        if (this.destroyed) return;
        const view = computeVoiceView(
            this.latest.values(),
            this.space.mySpaceUserId,
            this.statuses,
            isAreaSpaceName(this.space.getName())
        );
        views.update((all) => new Map(all).set(this.space, view));
    }

    destroy(): void {
        this.destroyed = true;
        for (const subscription of this.subscriptions) subscription.unsubscribe();
        for (const unsubscribe of this.unsubscribers) unsubscribe();
        views.update((all) => {
            const rest = new Map(all);
            rest.delete(this.space);
            return rest;
        });
    }
}

const watchers = new Map<SpaceInterface, { watcher: VoiceSpaceWatcher; count: number }>();

/**
 * Watches a bubble or meeting room we are in for voice bots. Returns the function to call when we are not in it any
 * more. Asking twice for the same space is one watch, kept until both let go.
 */
export function trackVoiceSpace(space: SpaceInterface): () => void {
    const known = watchers.get(space);
    if (known) {
        known.count++;
    } else {
        watchers.set(space, { watcher: new VoiceSpaceWatcher(space), count: 1 });
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const entry = watchers.get(space);
        if (!entry || --entry.count > 0) return;
        watchers.delete(space);
        entry.watcher.destroy();
    };
}

// ---- sound the browser has not let play ----

const blocked = writable<ReadonlySet<string>>(new Set());
/** The sound of each voice bot, as the game plays it: one element per connection. */
const audioElements = new Map<string, Set<HTMLMediaElement>>();

/** Bots whose sound the browser has not let start: the button asks for a tap. */
export const soundBlockedStore: Readable<ReadonlySet<string>> = { subscribe: blocked.subscribe };

function setBlocked(botSpaceUserId: string, value: boolean): void {
    blocked.update((ids) => {
        if (ids.has(botSpaceUserId) === value) return ids;
        const next = new Set(ids);
        if (value) next.add(botSpaceUserId);
        else next.delete(botSpaceUserId);
        return next;
    });
}

/** Tries to start the element and says so when the browser refuses without a tap (the only refusal that matters). */
function startSound(botSpaceUserId: string, element: HTMLMediaElement): void {
    if (!element.srcObject) return;
    let started: Promise<void> | undefined;
    try {
        started = element.play();
    } catch {
        return;
    }
    started?.then(
        () => setBlocked(botSpaceUserId, false),
        (error: unknown) => {
            if (error instanceof Error && error.name === "NotAllowedError") setBlocked(botSpaceUserId, true);
        }
    );
}

/**
 * The game plays a voice bot's sound with this element: it is watched for the browser refusing to start it, and
 * given back to the button's tap (resumeBotSound). Returns the function to call when the element goes away.
 */
export function watchBotAudio(botSpaceUserId: string, element: HTMLMediaElement): () => void {
    let elements = audioElements.get(botSpaceUserId);
    if (!elements) audioElements.set(botSpaceUserId, (elements = new Set()));
    elements.add(element);
    const attempt = () => startSound(botSpaceUserId, element);
    const playing = () => setBlocked(botSpaceUserId, false);
    element.addEventListener("loadedmetadata", attempt);
    element.addEventListener("playing", playing);
    attempt();
    return () => {
        element.removeEventListener("loadedmetadata", attempt);
        element.removeEventListener("playing", playing);
        const left = audioElements.get(botSpaceUserId);
        left?.delete(element);
        if (left?.size === 0) {
            audioElements.delete(botSpaceUserId);
            setBlocked(botSpaceUserId, false);
        }
    };
}

/**
 * Starts the bot's sound again. It must be called inside the tap itself: a browser lets sound start only from a
 * person's own gesture, and an iPhone stays silent unless it starts inside the tap.
 */
export function resumeBotSound(botSpaceUserId: string): void {
    audioContextManager.resumeAll().catch((error) => console.warn("Could not resume the audio context", error));
    for (const element of audioElements.get(botSpaceUserId) ?? []) startSound(botSpaceUserId, element);
}
