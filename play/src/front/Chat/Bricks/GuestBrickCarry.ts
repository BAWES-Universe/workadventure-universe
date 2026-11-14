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
    const chat = steps.read();
    if (!chat) return "none";
    if (!chat.carryTaken) {
        let handedOver: boolean;
        try {
            handedOver = await steps.take(chat.guestId);
        } catch (error) {
            console.warn("Could not ask for the chat this device had as a guest", error);
            return "later";
        }
        if (!handedOver) {
            // Not handed to this account (never talked, another account has it, no Brick): it stays no longer
            steps.drop();
            return "none";
        }
        // Signing out can drop the chat while the question is open: then there is nothing left to keep
        if (steps.read()?.guestId !== chat.guestId) return "none";
        // Orbit hands a chat over once: from here on it is only brought, never asked for again
        steps.keep({ ...chat, carryTaken: true });
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
        if (from >= now.lines.length) {
            steps.drop();
            return "carried";
        }
        // A bot server from before takes one message: the newest lines that fit, as it always did. A part that may have been
        // said already (its answer lost) goes again with the very same lines; lines said since wait for the next part
        const pending = now.carryingTo !== undefined && now.carryingTo > from ? now.carryingTo : undefined;
        const part = inParts ? carriedPart(now, from, pending) : carriedTail(now);
        if (inParts && pending === undefined) steps.keep({ ...now, carryingTo: part.to });
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
        from = part.to;
        const kept: GuestChat = { ...after, carriedTo: from };
        delete kept.carryingTo;
        steps.keep(kept);
    }
    /* eslint-enable no-await-in-loop */
}

/** True while a guest's chat is on its way into the Brick's chat, so the chat waits to say its own hello. */
const carrying = writable(false);
export const guestChatCarrying: Readable<boolean> = { subscribe: carrying.subscribe };

let running: Promise<CarryOutcome> | undefined;

/** Runs the carry once at a time, and says while it runs. */
export function bringGuestChat(steps: CarrySteps): Promise<CarryOutcome> {
    if (running) return running;
    if (!steps.read()) return Promise.resolve("none");
    carrying.set(true);
    running = carryGuestChatAlong(steps)
        .catch((error: unknown) => {
            console.error("Could not bring a guest's chat along", error);
            return "later" as const;
        })
        .finally(() => {
            running = undefined;
            carrying.set(false);
        });
    return running;
}
