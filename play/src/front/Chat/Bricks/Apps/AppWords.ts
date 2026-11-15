import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import { THINGS, settingsGroups, type Setting, type Thing } from "./Apps";

/** The name of one of the four things bots may use an app for, in the words the bot page's headings use */
export function thingLabel(LL: TranslationFunctions, thing: Thing): string {
    const text = LL.chat.brick.apps;
    switch (thing) {
        case "lookUp":
            return text.thingLookUp();
        case "make":
            return text.thingMake();
        case "change":
            return text.thingChange();
        case "deleteSend":
            return text.thingDeleteSend();
    }
}

const lowerFirst = (word: string) => word.charAt(0).toLowerCase() + word.slice(1);

/** Things in a row of words: the first with its capital, the rest in lower case */
function thingsLine(LL: TranslationFunctions, things: Thing[], capital: boolean): string {
    return things
        .map((thing, index) => (index === 0 && capital ? thingLabel(LL, thing) : lowerFirst(thingLabel(LL, thing))))
        .join(", ");
}

/**
 * What a Brick may do with an app, in one line: "Looks things up right away · Changes things ask first", from the four
 * settings it was given. "Can't use Gmail" when nothing is on, "Turned off" when the Brick's own switch for it is off.
 */
export function mayLine(
    LL: TranslationFunctions,
    app: string,
    settings: Record<Thing, Setting>,
    enabled: boolean
): string {
    const text = LL.chat.brick.apps;
    if (!enabled) return text.botOff();
    const groups = settingsGroups(settings);
    const parts: string[] = [];
    if (groups.rightAway.length > 0) {
        parts.push(
            groups.rightAway.length === THINGS.length
                ? text.everythingRightAway()
                : text.rightAway({ things: thingsLine(LL, groups.rightAway, true) })
        );
    }
    if (groups.asksFirst.length > 0) {
        parts.push(text.asksFirst({ things: thingsLine(LL, groups.asksFirst, parts.length === 0) }));
    }
    return parts.length > 0 ? parts.join(" · ") : text.cantUse({ app });
}

/**
 * What a person is told when Orbit would not do a change. Orbit words a refusal (a 422, or a 400) for people ("Maximum of 5 apps per bot
 * reached"), so it is shown as it is; anything else, a network failure included, is the plain "didn't go through" line.
 */
export function refusalWords(error: unknown, fallback: string): string {
    const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
    if (error instanceof Error && (status === 422 || status === 400)) {
        const words = error.message.trim();
        if (words && words.length <= 200 && !/^API error/i.test(words)) return words;
    }
    return fallback;
}
