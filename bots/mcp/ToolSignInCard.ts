/**
 * The Reconnect card a bot shows the people who manage it when a tool server turned its sign-in away (game #1819, mock
 * approved 5 Nov 2026). Pure: it builds the card, the notice that carries it in a direct message, and remembers who was
 * shown which outage so a card is not repeated on every reply.
 *
 * In a bubble the card is a private event (kind "signin" of the bot's ask event) to that person alone. In a direct message
 * it is a notice with the `universe.tool_signin` field. The game draws it above the message box, with an X, and checks
 * with Orbit that the sign-in is still lost before it shows it. No AI writes it.
 */

import type { ToolIssue, ToolIssueKind } from './ToolSignIn';

export const TOOL_SIGNIN_KEY = 'universe.tool_signin';

/** One connection that needs signing in again, as the card lists it. */
export interface ToolSignInLost {
    serverId: string;
    name: string;
    /** ISO time the bot server first saw the sign-in refused; the game shows it in the person's own clock */
    since: string;
    kind: ToolIssueKind;
}

export interface ToolSignInCard {
    lost: ToolSignInLost[];
}

const MAX_LOST = 10;

/** The card for the sign-ins that are lost, or null when none is. A server that merely did not answer has no card. */
export function toolSignInCard(issues: readonly ToolIssue[]): ToolSignInCard | null {
    const lost = issues
        .filter((issue) => issue.state === 'expired')
        .slice(0, MAX_LOST)
        .map(({ serverId, name, since, kind }) => ({ serverId, name: name.replace(/\s+/g, ' ').trim().slice(0, 60), since, kind }));
    return lost.length > 0 ? { lost } : null;
}

/** The same outage gives the same signature. */
function signature(card: ToolSignInCard | null): string {
    return card ? card.lost.map((one) => `${one.serverId}@${one.since}`).join('|') : '';
}

/** The card as a direct message's notice: other apps show the plain words, the game draws the card from the field. */
export function toolSignInContent(card: ToolSignInCard, botName: string): Record<string, unknown> {
    const names = card.lost.map((one) => one.name);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return {
        msgtype: 'm.notice',
        body: `${list} ${names.length === 1 ? 'needs' : 'need'} signing in again. ${botName} answers without ${names.length === 1 ? 'it' : 'them'} until it is reconnected.`,
        [TOOL_SIGNIN_KEY]: { lost: card.lost },
    };
}

const MAX_REMEMBERED = 1000;

/** Who was shown which outage, by bot and chat, so a card shows once per outage and chat and clears once. */
export class ToolSignInShown {
    private readonly shown = new Map<string, string>();

    /** True when this person should be shown the card now: they have not been shown this outage in this chat. */
    shouldShow(key: string, card: ToolSignInCard): boolean {
        const sig = signature(card);
        if (this.shown.get(key) === sig) return false;
        this.shown.delete(key);
        this.shown.set(key, sig);
        while (this.shown.size > MAX_REMEMBERED) this.shown.delete(this.shown.keys().next().value!);
        return true;
    }

    /** The outage is over: true when a card was shown here and should now be taken back. */
    cleared(key: string): boolean {
        return this.shown.delete(key);
    }
}
