import { derived, get, type Readable } from "svelte/store";
import type { ChatMessage } from "../Connection/ChatConnection";
import { currentStep, msUntilStale, stoppedIfStale, type BotSteps } from "./BotSteps";

/**
 * While a bot's steps line shows a tool running (#1545) the line shows what it does, so the typing dots wait: they show
 * before the first tool starts and again after the last one ends, while the bot writes its answer (#1674). The line
 * stays "working" through that writing, so it is the running step that counts, not the line's state. The ids are the
 * ones typing members go by: the chat ID in a direct message, the space user ID in the nearby chat.
 */
export function workingBotIds(messages: Readable<readonly ChatMessage[]>): Readable<ReadonlySet<string>> {
    // In an array: a chat's messages are an array that is also a store, and derived would take it for a list of stores.
    return derived(
        [messages],
        ([$messages], set) => {
            // Each bot's newest steps line is the one of the reply it is on now.
            const newest = new Map<string, Readable<BotSteps | undefined>>();
            for (const message of $messages) {
                // A direct message gives every message a steps store, empty unless the message is the steps line.
                if (!message.steps || !message.sender || get(message.steps) === undefined) continue;
                for (const id of [message.sender.chatId, message.sender.spaceUserId]) {
                    if (id) newest.set(id, message.steps);
                }
            }
            const working = new Set<string>();
            // A line left "working" for over an hour is stopped (it is drawn so), so it holds the typing dots back no longer
            const timers = new Set<ReturnType<typeof setTimeout>>();
            const unsubscribes = [...newest].map(([id, steps]) => {
                let timer: ReturnType<typeof setTimeout> | undefined;
                let last: BotSteps | undefined;
                const decide = () => {
                    if (timer) {
                        clearTimeout(timer);
                        timers.delete(timer);
                        timer = undefined;
                    }
                    const value = last;
                    if (value?.state === "working" && currentStep(value) && !stoppedIfStale(value, Date.now()).stale) {
                        working.add(id);
                        const wait = msUntilStale(value, Date.now());
                        if (wait !== undefined) {
                            timer = setTimeout(decide, wait);
                            timers.add(timer);
                        }
                    } else working.delete(id);
                    set(new Set(working));
                };
                return steps.subscribe((value) => {
                    last = value;
                    decide();
                });
            });
            set(new Set(working));
            return () => {
                unsubscribes.forEach((unsubscribe) => unsubscribe());
                timers.forEach((timer) => clearTimeout(timer));
            };
        },
        new Set<string>() as ReadonlySet<string>
    );
}

/** Who is typing, without the bots whose steps line is working. */
export function typingExceptWorkingBots<T extends { id: string }>(
    typingMembers: Readable<T[]>,
    working: Readable<ReadonlySet<string>>
): Readable<T[]> {
    return derived([typingMembers, working], ([$typingMembers, $working]) =>
        $typingMembers.filter((member) => !$working.has(member.id))
    );
}
