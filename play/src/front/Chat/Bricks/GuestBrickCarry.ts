import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { GuestChatLine } from "./Brick";
import { ASK_AGAIN_MS, ROOM_WAIT_MS } from "./Brick";
import { carriedPart, carriedTail, type CarriedPart, type GuestChat } from "./GuestBrick";

/**
 * A guest signs in, and the chat they had with the Brick for guests goes with them (game #1997). Orbit hands the chat to
 * the account that signed in, once; this device, which held it, takes it and has the bot server say it in the person's
 * own chat with their one Brick. It happens the first time that chat is opened, since that is when the chat exists.
 */
export interface CarrySteps {
    /** The chat this device kept as a guest, whoever it was kept for. Undefined when there is none. */
    read: () => GuestChat | undefined;
    /** Keeps the chat as it is now. */
    keep: (chat: GuestChat) => void;
    /** Removes it from the device. */
    drop: () => void;
    /** Asks Orbit whether this chat was handed to this account, and is this device's to bring. Throws when it can't be asked. */
    take: (guestId: string) => Promise<boolean>;
    /**
     * Has the bot server say one part of the chat in the Brick's chat. `refused` when it is not this person's to say. Throws when
     * it can't be asked. The same part asked again is said once.
     */
    carry: (
        carryId: string,
        lines: GuestChatLine[],
        part?: Pick<CarriedPart, "from" | "to" | "last">
    ) => Promise<"sent" | "already" | "wait" | "refused">;
    /** Whether the bot server takes the chat in parts; false for one from before, which takes one message. Throws when it can't be asked. */
    parts?: () => Promise<boolean>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

/** `none`: there was nothing to bring, or it is not this account's. `carried`: it is in the chat. `later`: ask again the next time the chat opens. */
export type CarryOutcome = "none" | "carried" | "later";

export async function carryGuestChatAlong(steps: CarrySteps): Promise<CarryOutcome> {
    let chat = steps.read();
    if (!chat) return "none";
    if (!chat.carryTaken) {
        let handedOver: boolean;
        try {
            handedOver = await steps.take(chat.guestId);
        } catch (error) {
            console.warn("Could not ask for the chat this device had as a guest", error);
            return "later";
        }
        // What the device holds now: signing out, or another guest's chat, can replace it while the question is open. What Orbit
        // answers is about the chat it was asked about, never about the one there now
        const current = steps.read();
        if (!current || current.guestId !== chat.guestId || current.startedAt !== chat.startedAt) return "none";
        if (!handedOver) {
            // Not handed to this account (never talked, another account has it, no Brick): it stays no longer
            steps.drop();
            return "none";
        }
        // Orbit hands a chat over once: from here on it is only brought, never asked for again. Kept as the device holds it
        // now, so a line said while the question was open stays
        chat = { ...current, carryTaken: true };
        steps.keep(chat);
    }
    // In parts, in order (plan v3 section 7): each part is kept as said before the next, so a carry cut short goes on where it
    // stopped, and the device keeps its chat until every line is in. A line said while this runs (an answer that came back
    // during sign-in) comes along in the next part
    let inParts: boolean;
    try {
        inParts = steps.parts ? await steps.parts() : true;
    } catch (error) {
        console.warn("Could not ask how the chat this device had as a guest is brought", error);
        return "later";
    }
    let from = chat.carriedTo ?? 0;
    const waitUntil = steps.now() + ROOM_WAIT_MS;
    /* eslint-disable no-await-in-loop */
    for (;;) {
        const now = steps.read();
        // Signed out, or another guest's chat since: nothing more of this one to bring
        if (!now || now.guestId !== chat.guestId || now.startedAt !== chat.startedAt) return "none";
        // Another tab may have brought more since: the place reached never moves back
        from = Math.max(from, now.carriedTo ?? 0);
        if (from >= now.lines.length) {
            steps.drop();
            return "carried";
        }
        // A part that may have been said already (its answer lost) goes again exactly as it went, lines and all: lines said since
        // wait for the next part. A bot server from before takes one message: the newest lines that fit, never ones it took
        const pending = inParts && now.carrying?.from === from ? now.carrying : undefined;
        const part = pending ?? (inParts ? carriedPart(now, from) : carriedTail(now, from));
        if (inParts && !pending) steps.keep({ ...now, carrying: part });
        let result: "sent" | "already" | "wait" | "refused";
        try {
            result = inParts
                ? await steps.carry(chat.guestId, part.lines, { from: part.from, to: part.to, last: part.last })
                : await steps.carry(chat.guestId, part.lines);
        } catch (error) {
            console.warn("Could not bring the chat this device had as a guest", error);
            return "later";
        }
        // Signed out, or another guest's chat since the question went: what it answers is not about the chat there now
        const after = steps.read();
        if (!after || after.guestId !== chat.guestId || after.startedAt !== chat.startedAt) return "none";
        if (result === "refused") {
            steps.drop();
            return "none";
        }
        if (result === "wait") {
            // Their chat with the Brick is being made: one question at a time, each after the answer to the one before
            if (steps.now() >= waitUntil) return "later";
            await steps.sleep(ASK_AGAIN_MS);
            continue;
        }
        from = Math.max(part.to, after.carriedTo ?? 0);
        const kept: GuestChat = { ...after, carriedTo: from };
        // Only the part that was just said stops being on its way: another tab may have one of its own
        if (after.carrying && after.carrying.to <= from) delete kept.carrying;
        steps.keep(kept);
    }
    /* eslint-enable no-await-in-loop */
}

/** True while a guest's chat is on its way into the Brick's chat, so the chat waits to say its own hello. */
const carrying = writable(false);
export const guestChatCarrying: Readable<boolean> = { subscribe: carrying.subscribe };

/** The carry in progress, and whose it is: one at a time for an account, and never one account's run for another's open. */
let running: { account: string; done: Promise<CarryOutcome> } | undefined;

/**
 * Runs the carry once at a time, and says while it runs. The same account asking again gets the run in progress; another account
 * (signed out and in again on this page) waits for it to end and then runs its own, reading what the device holds then.
 */
export function bringGuestChat(steps: CarrySteps, account = ""): Promise<CarryOutcome> {
    if (running && running.account === account) return running.done;
    if (!running && !steps.read()) return Promise.resolve("none");
    const before = running?.done;
    carrying.set(true);
    const mine: { account: string; done: Promise<CarryOutcome> } = {
        account,
        done: (before ?? Promise.resolve("none" as const)).then(() => carryGuestChatAlong(steps)),
    };
    mine.done = mine.done
        .catch((error: unknown) => {
            console.error("Could not bring a guest's chat along", error);
            return "later" as const;
        })
        .finally(() => {
            if (running === mine) {
                running = undefined;
                carrying.set(false);
            }
        });
    running = mine;
    return mine.done;
}
