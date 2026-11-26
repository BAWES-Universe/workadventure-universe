/**
 * "Who you are and what you can do" for a person's own Brick, in its direct messages: the Apps it has, the ones it can connect
 * in one tap, its computer and its reminders, said plainly at the top of its working notes. It exists so the Brick knows what it has
 * and acts on it, instead of finding out tool by tool and hesitating.
 *
 * Only names and one line each: what each tool does is in its own definition and note. Nothing here grants anything: what is Off, what
 * asks first and what is paid is decided in code, and the words say so. No vendor behind an App is ever named, no limit is written
 * in, and every App is called an App.
 */
import type { OfferableApp } from '../server/AdminApiService';

export interface BrickAbilities {
    /** The Apps it can use right now, by name. */
    apps: string[];
    /** Orbit said which Apps it has. When it could not, an empty list is not "none": nothing is said of Apps it has. */
    appsKnown: boolean;
    /** The Apps it can offer to connect (not usable yet, not declined). */
    connectable: Pick<OfferableApp, 'key' | 'name'>[];
    /** It has its own computer in this chat. */
    computer: boolean;
    /** It may keep reminders, briefings, watches and goals for this person. */
    reminders: boolean;
    /** It has Instant Apps. */
    instant: boolean;
    /** It may offer an App to connect (offer_app is one of its tools). */
    canOffer: boolean;
}

/** The names, once each, in the order given, at most `max` (more is a menu, not a hint). */
function names(list: string[], max: number): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
        const name = raw.replace(/\s+/g, ' ').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out.length > max ? `${out.slice(0, max).join(', ')} and more` : out.join(', ');
}

const MAX_NAMES = 20;

export function brickAbilitiesNote(can: BrickAbilities): string {
    const lines = ["**WHO YOU ARE AND WHAT YOU CAN DO NOW:** You are this person's own Brick. You work for them, and what follows is true right now: trust it over any doubt, and use it without asking whether you may."];
    const have = names(can.apps, MAX_NAMES);
    if (have) lines.push(`- Apps you have: ${have}. Use them the moment a job needs one.`);
    else if (can.appsKnown) lines.push('- You have no Apps connected yet.');
    const connectable = names(
        can.connectable.map((app) => app.name),
        MAX_NAMES
    );
    if (can.canOffer && connectable) {
        lines.push(`- Apps you can connect in one tap: ${connectable}. When a job needs one of them, say in one short line what it needs and offer to connect it with offer_app in that same reply, before you try any other way.`);
    } else if (can.canOffer) {
        lines.push("- When a job needs an App that is in none of your lists, say in one short line that you can't reach it from here yet, and do the closest thing you can.");
    }
    if (can.computer) lines.push('- You have your own computer. Use it for jobs an App and your own knowledge cannot do, such as a page that needs a real browser, files, or code.');
    if (can.instant) lines.push('- You can run Instant Apps for them, as your Instant Apps note says.');
    if (can.reminders) lines.push('- You can keep reminders, briefings, watches and goals for them when they ask.');
    lines.push('- What they turned Off for you stays off, and what asks first still asks. You never get round either: say so in one plain line and offer what you can do.');
    return lines.join('\n');
}
