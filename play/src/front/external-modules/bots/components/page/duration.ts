/**
 * Durations on the bot page's chips: under a minute in seconds ("30 s"), whole minutes in minutes ("3 min"). A saved
 * value that is none of a setting's chips gets a chip of its own, so the page never hides what the bot is set to.
 */
import { get } from "svelte/store";
import LL from "../../../../../i18n/i18n-svelte";

export function durationLabel(seconds: number): string {
    const page = get(LL).mapEditor.edit.bots.page;
    if (seconds >= 60 && seconds % 60 === 0) {
        return page.minutes({ count: seconds / 60 });
    }
    return page.seconds({ count: seconds });
}

/** Chips for these durations (in seconds), plus the current one when it is not among them. */
export function durationChips(choices: number[], current: number): Array<{ value: number; label: string }> {
    const values = choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
    return values.map((value) => ({ value, label: durationLabel(value) }));
}
