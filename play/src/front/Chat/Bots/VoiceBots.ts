/**
 * The voice bots in the bubble or meeting we are in (#1666), and where the voice of the first one stands.
 *
 * A space with media (a bubble, a meeting room) is watched while we are in it (trackVoiceSpace). A bot is a voice bot
 * when its token says so or when it sends us a voice status; the status event is trusted only from a bot about
 * itself (the pusher refuses anything else, and this checks again). Each status moves the bot between connecting,
 * on and paused. The first time a bot's status arrives, and each time it starts connecting again, our saved choice
 * is sent to it, and again whenever the choice changes: the bot (and its voice worker) enforce it.
 *
 * Two voice bots in one bubble: only the first one gets the button. Both bots say their voice is paused then (#1670),
 * so the button shows that, and the chat says why (TwoVoiceBots.ts).
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
    voiceBarFor,
    voiceModeOf,
    type BotVoiceStatus,
    type ListenReason,
    type ListenState,
    type VoiceBar,
    type VoiceBotState,
    type VoiceChoice,
} from "./VoiceMode";
import { playVoiceCue } from "./VoiceCues";

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
    /** The spoken replies this person has left, and when their window ends (ms): what the Voice menu says at the bottom (#1669). */
    repliesLeft: number | undefined;
    repliesResetAt: number | undefined;
    /** Whether it takes this person's microphone in a group, and why not (round 8). "": nothing to choose, as before. */
    listening: ListenState;
    listeningReason: ListenReason;
    /** The short bar that explains the latest change, and a number that changes each time one is shown (so the same bar can show again). */
    bar: VoiceBar | undefined;
    barSeq: number;
    /** The reply people are hearing it say now, by its response id (round 8): it shows Stop speaking. */
    speaking: string | undefined;
}

/** The latest bar for each bot, by space user id (see voiceBarFor). */
export type VoiceBars = ReadonlyMap<string, { bar: VoiceBar; seq: number }>;

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
    /** Asks a bot here to keep listening to us in the group, or to stop (round 8). */
    askToListen: (botSpaceUserId: string, listen: "keep" | "stop") => void;
    /** Asks a bot here to stop saying the reply it is saying, for everyone, as speaking over it would (round 8). */
    stopSpeaking: (botSpaceUserId: string) => void;
}

type ViewUser = Pick<SpaceUserExtended, "spaceUserId" | "uuid" | "tags" | "name" | "pictureStore">;

/** What the button and the menu need from who is in a space and what the bots said (pure, so it is tested alone). */
export function computeVoiceView(
    users: Iterable<ViewUser>,
    mySpaceUserId: string,
    statuses: ReadonlyMap<string, BotVoiceStatus>,
    meeting: boolean,
    /** A bot this person blocked shows nothing on the button, as with its messages and its status. */
    isBlocked: (user: ViewUser) => boolean = () => false,
    bars: VoiceBars = new Map(),
    askToListen: VoiceSpaceView["askToListen"] = () => undefined,
    speaking: ReadonlyMap<string, string> = new Map(),
    stopSpeaking: VoiceSpaceView["stopSpeaking"] = () => undefined
): VoiceSpaceView {
    const bots: VoiceBotView[] = [];
    const botSpaceUserIds: string[] = [];
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
        // A blocked bot is still told apart from people, so our choice not to hear bots keeps silencing its sound
        botSpaceUserIds.push(user.spaceUserId);
        if (isBlocked(user)) continue;
        bots.push({
            spaceUserId: user.spaceUserId,
            botId: status?.botId ?? (user.uuid ?? "").replace(/^bot-/, ""),
            name: status?.botName || user.name,
            picture: user.pictureStore,
            // Until the bot says, its voice is on its way
            state: status?.state ?? "connecting",
            followUpSeconds: status?.followUpSeconds ?? 0,
            repliesLeft: status?.repliesLeft,
            repliesResetAt: status?.repliesResetAt,
            listening: status?.listening ?? "",
            listeningReason: status?.listeningReason ?? "",
            bar: bars.get(user.spaceUserId)?.bar,
            barSeq: bars.get(user.spaceUserId)?.seq ?? 0,
            speaking: speaking.get(user.spaceUserId),
        });
    }
    if (!meIncluded) people++;
    return { meeting, bot: bots[0], botSpaceUserIds, people, othersPresent, askToListen, stopSpeaking };
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
    private readonly bars = new Map<string, { bar: VoiceBar; seq: number }>();
    /** The reply each bot is being heard saying, by its response id. */
    private readonly speaking = new Map<string, string>();
    /** Bots that already told us, this visit, that they don't listen in the group: that bar shows once. */
    private readonly toldNotListening = new Set<string>();
    private barSeq = 0;
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
                for (const id of [...this.bars.keys()]) if (!users.has(id)) this.bars.delete(id);
                for (const id of [...this.speaking.keys()]) if (!users.has(id)) this.speaking.delete(id);
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
        // A bot says, for everyone, when a reply of its starts being heard and when its audio is over (round 8)
        this.subscriptions.push(
            space.observePublicEvent("spaceStreamMessage").subscribe((event) => {
                const stream = event.spaceStreamMessage;
                const sender = this.latest.get(event.sender);
                if (stream.speaking === undefined || !sender || !isBot(sender)) return;
                if (stream.speaking) this.speaking.set(event.sender, stream.responseId);
                else if (this.speaking.get(event.sender) === stream.responseId) this.speaking.delete(event.sender);
                else return;
                this.publish();
            })
        );
        // Blocking or unblocking a bot already here changes the button at once, not at the next change in the room
        this.subscriptions.push(
            blackListManager.onBlockStream.subscribe(() => this.publish()),
            blackListManager.onUnBlockStream.subscribe(() => this.publish())
        );
        this.unsubscribers.push(voiceChoiceStore.subscribe(() => this.sendChoiceToBots()));
    }

    private onStatus(botSpaceUserId: string, status: BotVoiceStatus): void {
        const before = this.statuses.get(botSpaceUserId);
        this.statuses.set(botSpaceUserId, status);
        this.updateBar(botSpaceUserId, before, status);
        this.publish();
        // The bot learns our choice when it first speaks to us, and when it starts a new connection
        if (!before || (before.state !== "connecting" && status.state === "connecting")) {
            this.sendChoice(botSpaceUserId);
        }
    }

    /** The bar for what just changed, and the soft sound on this person's device only: listening paused, or listening confirmed. */
    private updateBar(botSpaceUserId: string, before: BotVoiceStatus | undefined, status: BotVoiceStatus): void {
        const bar = voiceBarFor(before, status, this.toldNotListening.has(botSpaceUserId));
        if (status.listening === "off" && status.listeningReason === "") this.toldNotListening.add(botSpaceUserId);
        if (bar) {
            this.bars.set(botSpaceUserId, { bar, seq: ++this.barSeq });
            if (bar === "paused") playVoiceCue("paused");
            else if (bar === "listening") playVoiceCue("ready");
            return;
        }
        // A bar is about the change it came with: any other change in listening ends it
        if ((before?.listening ?? "") !== status.listening) this.bars.delete(botSpaceUserId);
    }

    private sendChoiceToBots(): void {
        for (const id of this.statuses.keys()) this.sendChoice(id);
    }

    private sendChoice(botSpaceUserId: string, listen: "" | "keep" | "stop" = "", stopSpeaking = ""): void {
        if (this.destroyed || this.space.destroyed) return;
        this.space.emitPrivateMessage(
            {
                $case: "voiceModeChoice",
                voiceModeChoice: { mode: voiceModeOf(get(voiceChoiceStore)), listen, stopSpeaking },
            },
            botSpaceUserId
        );
    }

    /** Asks a bot to stop the reply it is saying. The button goes at once; the bot's own word that the audio is over follows. */
    private stopSpeaking(botSpaceUserId: string): void {
        const responseId = this.speaking.get(botSpaceUserId);
        if (!responseId) return;
        this.speaking.delete(botSpaceUserId);
        this.sendChoice(botSpaceUserId, "", responseId);
        this.publish();
    }

    /** Asks one bot here to keep listening to us in the group, or to stop. Only a bot that told us about listening is asked. */
    private askToListen(botSpaceUserId: string, listen: "keep" | "stop"): void {
        if (!this.statuses.get(botSpaceUserId)?.listening) return;
        this.sendChoice(botSpaceUserId, listen);
    }

    private publish(): void {
        if (this.destroyed) return;
        const view = computeVoiceView(
            this.latest.values(),
            this.space.mySpaceUserId,
            this.statuses,
            isAreaSpaceName(this.space.getName()),
            (user) => !!user.uuid && blackListManager.isBlackListed(user.uuid),
            this.bars,
            (botSpaceUserId, listen) => this.askToListen(botSpaceUserId, listen),
            this.speaking,
            (botSpaceUserId) => this.stopSpeaking(botSpaceUserId)
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
