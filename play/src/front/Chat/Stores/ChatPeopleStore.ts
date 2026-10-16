import { derived, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { ChatPersonAnswer } from "@workadventure/messages";
import type { PictureStore } from "../../Stores/PictureStore";
import type { ChatUser } from "../Connection/ChatConnection";
import { storedWokaStore } from "./StoredWokaStore";

type UsersByRoom = Map<string | undefined, { roomName: string | undefined; users: ChatUser[] }>;

/** What Orbit says about one person who is not in your world: their current name and the Woka it draws for them. */
export interface ChatPerson {
    name?: string;
    picture?: PictureStore;
}

export type AskChatPerson = (chatId: string) => Promise<ChatPersonAnswer>;

/** At most this many questions are out at once, so a long chat list never floods the server. */
const MAX_IN_FLIGHT = 3;
/** An answer older than this is asked for again the next time the chat shows that person (their Woka or name may have changed). */
const REFRESH_AFTER_MS = 2 * 60_000;
/** A question that failed (network, server) is asked again no sooner than this, on its own while the chat stays open. */
const RETRY_AFTER_MS = 60_000;
/** A question that keeps failing is asked again on its own at most this many times (a later request still asks). */
const MAX_AUTO_RETRIES = 3;

type Asked =
    | { status: "pending"; failures: number }
    | { status: "done"; at: number }
    | { status: "failed"; at: number; failures: number };
type Schedule = (retry: () => void, delayMs: number) => void;

/**
 * People the chat only knows from a direct chat (they are not in your world, so neither the map nor the world's member
 * list says what they look like): asked of Orbit per chat ID, and kept for as long as this connection lives (a new room
 * is a new connection, and Orbit draws people from the world you are in). The chat asks again when it shows someone
 * whose answer is a couple of minutes old, so a changed Woka or name shows up without a reload.
 */
export class ChatPeople {
    private readonly people = writable(new Map<string, ChatPerson>());
    private readonly asked = new Map<string, Asked>();
    private readonly queue: string[] = [];
    private inFlight = 0;

    /** Everyone asked about so far, by chat ID. */
    readonly store: Readable<Map<string, ChatPerson>> = { subscribe: this.people.subscribe };

    constructor(
        private readonly ask: AskChatPerson,
        private readonly now: () => number = () => Date.now(),
        private readonly schedule: Schedule = (retry, delayMs) => {
            setTimeout(retry, delayMs);
        }
    ) {}

    /**
     * Asks about this person unless the question is still out, or the answer is recent. A failed question is asked again
     * after a while, and an old answer is asked for again (the old name and picture stay until the new answer comes).
     */
    request(chatId: string): void {
        const asked = this.asked.get(chatId);
        if (asked?.status === "pending") return;
        if (asked?.status === "done" && this.now() - asked.at < REFRESH_AFTER_MS) return;
        if (asked?.status === "failed" && this.now() - asked.at < RETRY_AFTER_MS) return;
        this.enqueue(chatId, asked?.status === "failed" ? asked.failures : 0);
    }

    /** The scheduled retry after a failure: asks again unless someone already did (no clock check, timers can run early). */
    private retry(chatId: string): void {
        const asked = this.asked.get(chatId);
        if (asked?.status === "failed") this.enqueue(chatId, asked.failures);
    }

    private enqueue(chatId: string, failures: number): void {
        this.asked.set(chatId, { status: "pending", failures });
        this.queue.push(chatId);
        this.pump();
    }

    private pump(): void {
        while (this.inFlight < MAX_IN_FLIGHT) {
            const chatId = this.queue.shift();
            if (chatId === undefined) return;
            this.inFlight++;
            this.ask(chatId)
                .then((answer) => {
                    this.asked.set(chatId, { status: "done", at: this.now() });
                    const name = answer.wokaName?.trim();
                    const picture = storedWokaStore(answer.characterTextures);
                    if (!name && !picture) return;
                    this.people.update((people) => new Map(people).set(chatId, { name: name || undefined, picture }));
                })
                .catch((error) => {
                    const previous = this.asked.get(chatId);
                    const failures = (previous?.status === "pending" ? previous.failures : 0) + 1;
                    this.asked.set(chatId, { status: "failed", at: this.now(), failures });
                    console.warn("Could not ask for a person by chat ID", error);
                    // The chat shows the same person until something changes, so nothing would ask again: retry here.
                    if (failures <= MAX_AUTO_RETRIES) this.schedule(() => this.retry(chatId), RETRY_AFTER_MS);
                })
                .finally(() => {
                    this.inFlight--;
                    this.pump();
                });
        }
    }
}

const peopleByConnection = new WeakMap<object, ChatPeople>();

/** The people of this connection (one set per connection, so each room asks afresh), or none without a connection. */
export function chatPeopleOf(connection: { queryChatPerson: AskChatPerson } | undefined): ChatPeople | undefined {
    if (!connection) return undefined;
    let people = peopleByConnection.get(connection);
    if (!people) {
        people = new ChatPeople((chatId) => connection.queryChatPerson(chatId));
        peopleByConnection.set(connection, people);
    }
    return people;
}

/**
 * Whether the world already says what this person looks like: they are in it right now, or its member list carries
 * their saved Woka. Only people it does not cover are worth asking Orbit about.
 */
export function worldKnowsWoka(usersByRoom: UsersByRoom, chatId: string): boolean {
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (user.chatId !== chatId) continue;
            if (user.storedWoka !== undefined || (user.spaceUserId !== undefined && user.pictureStore !== undefined))
                return true;
        }
    }
    return false;
}

/** Whether this person is in the world's member list but not in the room right now, so the list is all that says what they look like. */
export function isAwayMember(usersByRoom: UsersByRoom, chatId: string): boolean {
    for (const { users } of usersByRoom.values()) {
        for (const user of users) {
            if (user.chatId === chatId && user.storedWoka !== undefined && user.spaceUserId === undefined) return true;
        }
    }
    return false;
}

/** The first of two pictures that has one; the same pair always gives the same store, so a list does not redraw. */
const pairedPictures = new WeakMap<object, WeakMap<object, PictureStore>>();
export function firstPicture(first: PictureStore, second: PictureStore): PictureStore {
    let bySecond = pairedPictures.get(first);
    if (!bySecond) {
        bySecond = new WeakMap();
        pairedPictures.set(first, bySecond);
    }
    let paired = bySecond.get(second);
    if (!paired) {
        paired = derived([first, second], ([a, b]) => a ?? b);
        bySecond.set(second, paired);
    }
    return paired;
}
