import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { GuestChatLine } from "./Brick";
import { ASK_AGAIN_MS, ROOM_WAIT_MS } from "./Brick";
import { carriedLines, type GuestChat } from "./GuestBrick";

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
    /** Has the bot server say the lines in the Brick's chat. `refused` when they are not this person's to say. Throws when it can't be asked. */
    carry: (carryId: string, lines: GuestChatLine[]) => Promise<"sent" | "already" | "wait" | "refused">;
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
    const lines = carriedLines(chat);
    const waitUntil = steps.now() + ROOM_WAIT_MS;
    /* eslint-disable no-await-in-loop */
    for (;;) {
        let result: "sent" | "already" | "wait" | "refused";
        try {
            result = await steps.carry(chat.guestId, lines);
        } catch (error) {
            console.warn("Could not bring the chat this device had as a guest", error);
            return "later";
        }
        if (result !== "wait") {
            steps.drop();
            return result === "refused" ? "none" : "carried";
        }
        // Their chat with the Brick is being made: one question at a time, each after the answer to the one before
        if (steps.now() >= waitUntil) return "later";
        await steps.sleep(ASK_AGAIN_MS);
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
