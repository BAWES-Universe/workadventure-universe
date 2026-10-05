import { derived, get, writable } from "svelte/store";
import { FOLLOW_REQUEST_TIMEOUT_MS } from "@workadventure/shared-utils";
import { getColorRgbFromHue } from "../WebRtc/ColorGenerator";
import { gameManager } from "../Phaser/Game/GameManager";
import PopUpFollow from "../Components/PopUp/PopUpFollow.svelte";
import { popupStore } from "./PopupStore";
import { bubbleMatesStore } from "./CurrentPlayerGroupStore";

/**
 * - off: nothing going on.
 * - requesting: a leader waits for answers (the card with the bar), or someone was asked and has not answered yet.
 * - active: leading or following (the small pill).
 */
export type FollowState = "off" | "requesting" | "active";
export type FollowRole = "leader" | "follower";
export type FollowAnswer = "waiting" | "following" | "declined";

export interface FollowPerson {
    userId: number;
    name: string;
}

export interface FollowAsked extends FollowPerson {
    answer: FollowAnswer;
}

/**
 * The short note shown for a few seconds when a request or a follow ends on its own.
 * - Leader: saidNo, noAnswer (one person asked), nobodySaidYes (several).
 * - Follower: cancelled, stoppedLeading, timedOut.
 */
export type FollowNoteKind = "saidNo" | "noAnswer" | "nobodySaidYes" | "cancelled" | "stoppedLeading" | "timedOut";

export interface FollowNote {
    kind: FollowNoteKind;
    person?: FollowPerson;
}

export const FOLLOW_NOTE_DURATION_MS = 3_000;

export const followStateStore = writable<FollowState>("off");
export const followRoleStore = writable<FollowRole>("leader");
/** The leader: everyone asked, and what they answered so far. Empty for a follower and once the answers are in. */
export const followAskedStore = writable<FollowAsked[]>([]);
/** While a request waits for answers: when its time started (Date.now()), for the bar. */
export const followRequestStartedAtStore = writable<number | undefined>(undefined);
export const followNoteStore = writable<FollowNote | undefined>(undefined);

const names = new Map<number, string>();
let requestTimer: ReturnType<typeof setTimeout> | undefined;
let noteTimer: ReturnType<typeof setTimeout> | undefined;
/** A follower: when the time to answer the last request ends (it tells a cancelled request from a timed out one). */
let followerDeadline = 0;

function remember(person: FollowPerson): void {
    if (person.name !== "") {
        names.set(person.userId, person.name);
    }
}

/** The name last seen for this person: the notes still name someone who has left the map since. */
export function followNameOf(userId: number): string {
    return names.get(userId) ?? "";
}

function personOf(userId: number): FollowPerson {
    return { userId, name: names.get(userId) ?? "" };
}

function startRequestTimer(onEnd: () => void): void {
    stopRequestTimer();
    followRequestStartedAtStore.set(Date.now());
    requestTimer = setTimeout(() => {
        requestTimer = undefined;
        onEnd();
    }, FOLLOW_REQUEST_TIMEOUT_MS);
}

function stopRequestTimer(): void {
    if (requestTimer !== undefined) {
        clearTimeout(requestTimer);
        requestTimer = undefined;
    }
    followRequestStartedAtStore.set(undefined);
}

function showNote(note: FollowNote): void {
    if (noteTimer !== undefined) {
        clearTimeout(noteTimer);
    }
    followNoteStore.set(note);
    noteTimer = setTimeout(() => {
        noteTimer = undefined;
        followNoteStore.set(undefined);
    }, FOLLOW_NOTE_DURATION_MS);
}

function clearNote(): void {
    if (noteTimer !== undefined) {
        clearTimeout(noteTimer);
        noteTimer = undefined;
    }
    followNoteStore.set(undefined);
}

function createFollowUsersStore() {
    // The leader: who follows. A follower: the leader, alone.
    const { subscribe, update, set } = writable<number[]>([]);

    function reset(): void {
        stopRequestTimer();
        set([]);
        followAskedStore.set([]);
        followStateStore.set("off");
        followRoleStore.set("leader");
    }

    function isLeading(): boolean {
        return get(followRoleStore) === "leader" && get(followStateStore) !== "off";
    }

    function setAnswer(userId: number, answer: FollowAnswer): void {
        followAskedStore.update((asked) => {
            if (!asked.some((person) => person.userId === userId)) {
                // Asked by the server although this screen did not see them in the bubble yet.
                return [...asked, { ...personOf(userId), answer }];
            }
            return asked.map((person) => (person.userId === userId ? { ...person, answer } : person));
        });
    }

    /**
     * The leader's window to answer closes: everyone answered, or the time is up. With at least one follower, the
     * card becomes the small "is following you" pill; with none, it closes with a note.
     */
    function closeRequestWindow(): void {
        stopRequestTimer();
        const asked = get(followAskedStore);
        if (get({ subscribe }).length > 0) {
            followAskedStore.set([]);
            followStateStore.set("active");
            return;
        }
        reset();
        if (asked.length === 1) {
            showNote({ kind: asked[0].answer === "declined" ? "saidNo" : "noAnswer", person: asked[0] });
        } else {
            showNote({ kind: "nobodySaidYes" });
        }
    }

    function closeWindowIfEveryoneAnswered(): void {
        const asked = get(followAskedStore);
        if (asked.length > 0 && asked.every((person) => person.answer !== "waiting")) {
            closeRequestWindow();
        }
    }

    return {
        subscribe,
        /**
         * The leader asked everyone else in the bubble. The card waits until they all answered or the time is up.
         */
        startRequest(asked: FollowPerson[]): void {
            clearNote();
            asked.forEach(remember);
            set([]);
            followRoleStore.set("leader");
            followAskedStore.set(asked.map((person) => ({ ...person, answer: "waiting" })));
            followStateStore.set("requesting");
            startRequestTimer(closeRequestWindow);
        },
        /**
         * Someone asks us to follow them. The question goes away by itself when the time is up.
         */
        addFollowRequest(leader: FollowPerson): void {
            clearNote();
            remember(leader);
            set([leader.userId]);
            followAskedStore.set([]);
            followRoleStore.set("follower");
            followStateStore.set("requesting");
            followerDeadline = Date.now() + FOLLOW_REQUEST_TIMEOUT_MS;
            startRequestTimer(() => {
                if (get(followRoleStore) === "follower" && get(followStateStore) === "requesting") {
                    reset();
                    showNote({ kind: "timedOut", person: personOf(leader.userId) });
                }
            });
        },
        /**
         * We follow the leader who asked (we said yes, or a script made us).
         */
        follow(): void {
            stopRequestTimer();
            followRoleStore.set("follower");
            followStateStore.set("active");
        },
        /**
         * The leader: someone said yes and follows us now.
         */
        addFollower(user: FollowPerson): void {
            remember(user);
            if (get(followStateStore) === "off") {
                // A script's followMe() asks without the card: the followers come straight in.
                clearNote();
                followRoleStore.set("leader");
                followStateStore.set("active");
            } else if (get(followRoleStore) !== "leader") {
                return;
            }
            update((followers) => (followers.includes(user.userId) ? followers : [...followers, user.userId]));
            if (get(followStateStore) === "requesting") {
                setAnswer(user.userId, "following");
                closeWindowIfEveryoneAnswered();
            }
        },
        /**
         * The leader: someone said no, or a follower stopped following. While others are still deciding, the card
         * stays; once nobody follows anymore, it is over.
         */
        removeFollower(user: number): void {
            if (!isLeading()) {
                return;
            }
            update((followers) => followers.filter((id) => id !== user));
            if (get(followStateStore) === "requesting") {
                setAnswer(user, "declined");
                closeWindowIfEveryoneAnswered();
            } else if (get({ subscribe }).length === 0) {
                reset();
            }
        },
        /**
         * A follower: the leader cancelled the request, stopped leading, or the request was over before our yes
         * arrived (follower is 0 then).
         */
        endFromLeader(leader: number, follower: number): void {
            const state = get(followStateStore);
            if (get(followRoleStore) !== "follower" || state === "off" || get({ subscribe })[0] !== leader) {
                return;
            }
            let kind: FollowNoteKind;
            if (state === "requesting") {
                kind = "cancelled";
            } else if (follower === 0) {
                kind = Date.now() < followerDeadline ? "cancelled" : "timedOut";
            } else {
                kind = "stoppedLeading";
            }
            reset();
            showNote({ kind, person: personOf(leader) });
        },
        /**
         * Everything stops, without a note: we cancelled, said no, or stopped ourselves.
         */
        stopFollowing(): void {
            reset();
        },
    };
}

export const followUsersStore = createFollowUsersStore();

/**
 * This store contains the color of the follow group. It is derived from the ID of the leader.
 */
export const followUsersColorStore = derived(
    [followStateStore, followRoleStore, followUsersStore],
    ([$followStateStore, $followRoleStore, $followUsersStore]) => {
        if ($followStateStore !== "active") {
            return undefined;
        }

        if ($followUsersStore.length === 0) {
            return undefined;
        }

        let leaderId: number;
        if ($followRoleStore === "leader") {
            // Let's get my ID by a quite complicated way....
            leaderId = gameManager.getCurrentGameScene().connection?.getUserId() ?? 0;
        } else {
            leaderId = $followUsersStore[0];
        }

        // Let's compute a random hue between 0 and 1 that varies enough to be interesting
        const hue = ((leaderId * 197) % 255) / 255;

        let { r, g, b } = getColorRgbFromHue(hue);
        if ($followRoleStore === "follower") {
            // Let's make the followers very slightly darker
            r *= 0.9;
            g *= 0.9;
            b *= 0.9;
        }
        return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
    }
);

export const suscriptionFollowStore = derived(
    [followStateStore, followNoteStore],
    ([$followStateStore, $followNoteStore]) => $followStateStore !== "off" || $followNoteStore !== undefined
).subscribe((visible) => {
    if (visible) {
        popupStore.addPopup(PopUpFollow, {}, "popupFollow");
    } else {
        popupStore.removePopup("popupFollow");
    }
});

/**
 * Asks everyone else in the bubble to follow us, and shows the card waiting for their answers.
 */
export function askToFollow(): void {
    const gameScene = gameManager.getCurrentGameScene();
    const asked = get(bubbleMatesStore).map((userId) => ({
        userId,
        name: gameScene.MapPlayersByKey.get(userId)?.playerName ?? "",
    }));
    gameScene.connection?.emitFollowRequest();
    followUsersStore.startRequest(asked);
}

/**
 * Says yes to the question on screen: our Woka walks behind the leader from now on.
 */
export function acceptFollowRequest(): void {
    const leader = get(followUsersStore)[0];
    if (leader === undefined) {
        return;
    }
    followUsersStore.follow();
    gameManager.getCurrentGameScene().connection?.emitFollowConfirmation(leader);
}

/**
 * The way out of every state: the leader cancels the request or stops leading (for everyone), the one asked says
 * "Not now", a follower stops following.
 */
export function endFollow(): void {
    if (get(followStateStore) !== "off") {
        // Sent before the stores reset: it reads who leads from them.
        gameManager.getCurrentGameScene().connection?.emitFollowAbort();
    }
    followUsersStore.stopFollowing();
}
