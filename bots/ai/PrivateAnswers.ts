/**
 * Private answers in a group (game #1993).
 *
 * With other people in the bubble or meeting room, the reply everyone reads is built without anything they were not
 * there for (see memory/Heard.ts), so there is nothing in it to keep secret. When the answer needs one of those things,
 * the model says so with one fixed marker and nothing else. The server then makes a second answer with everything the
 * bot and the person share, and sends it to that person alone, as a reply only they see. Everyone else reads one fixed
 * line no model wrote.
 *
 * This file holds the words and the small parts of that: the marker and the watch that keeps it off every screen, the
 * rules added to the prompt, the fixed line, and the replies kept so they come back with their person after a reload.
 */

/** What the model answers, alone, when the answer needs something the others were not there for. Never shown. */
export const PRIVATE_MARKER = '[PRIVATE_REPLY]';

/** A reply only one person sees keeps coming back with them for this long, and no more than this many (as cards' replies do). */
const KEPT_MS = 2 * 60 * 60 * 1000;
const KEPT = 10;
/** How many people's replies are kept at once, across bots. */
const MAX_KEPT_FOR = 500;

/**
 * What these answers need of a bot's client. Written out, not taken from the client's own type: the tools and the voice
 * read this file for its words, and must not bring the whole client along with it.
 */
interface AnswersBot {
    getBotId(): string;
    sendAskEvent(spaceName: string, playerId: number, event: { kind: 'card' | 'reply'; id: string; revision: number; body: string }): boolean;
    getPersonForArtifacts(playerId: number): { signedIn: boolean; identifier: string | null; name: string | null };
    chatIdOf?(playerId: number): string | undefined;
}

const called = (name: string | null | undefined): string => (name && name.trim() ? name.trim() : 'this person');

/**
 * The rule a shared reply gets, only when the bot knows something about this person that the others here were not there
 * for. It goes at the end of the prompt, after what a provider caches.
 */
export function privateAnswerRule(name: string | null | undefined): string {
    const who = called(name);
    return [
        'PRIVATE THINGS:',
        `Other people are here and read this reply. You know more about ${who} than you are shown now: what they told you in direct messages, or when nobody else was around, is left out, because the others were not there for it.`,
        `If answering ${who}'s message needs any of that (something they told you privately, their own plans or details, their files), reply with exactly ${PRIVATE_MARKER} and nothing else: no greeting, no explanation, no hint of what it is about. ${who} will then get the full answer from you alone.`,
        'For everything else, answer as usual.',
    ].join(' ');
}

/**
 * What a file or artifact tool adds, in a reply other people read, when it found nothing all of them may see: the tool
 * is not told whether the person has such a thing elsewhere, so neither is the model, and it never guesses out loud.
 */
export const ASK_IN_PRIVATE =
    "Only what everyone here was shown can be used while other people are here. If they mean something of their own from a private chat with you, don't guess at it: tell them in one short line that you can go through it with them in direct messages.";

/** In a group: what someone else told the bot is theirs to share. */
export function othersHereRule(name: string | null | undefined): string {
    const who = called(name);
    return [
        "OTHER PEOPLE'S THINGS:",
        'Other people are here and read this reply. You talk with each of them on their own too, and what someone told you privately is theirs: you are not shown it now, and you never say whether you know it.',
        `If ${who} asks about another person's private matters, say that it is theirs to share (use that person's name when ${who} did), and offer to help ${who} with something else.`,
    ].join(' ');
}

/** The rule the second answer gets: it is for one person alone. */
export function onlyForThemRule(name: string | null | undefined): string {
    const who = called(name);
    return [
        `ONLY ${who.toUpperCase()} READS THIS REPLY:`,
        `Other people are nearby, but this reply goes to ${who} alone, in writing. Nobody else sees it. Answer their message fully, with everything you know about them.`,
        'You have no tools in this reply. If it needs one, say what you can, and that they can carry on with you in direct messages.',
    ].join(' ');
}

/** The one line everyone reads when an answer went to its person alone. No model writes it. */
export function answeredPrivatelyLine(name: string | null | undefined): string {
    return name && name.trim() ? `${name.trim()}, I've answered that just for you.` : "I've answered that just for you.";
}

const EMOTION_BLOCK = /\[EMOTION_UPDATE\][\s\S]*?\[\/EMOTION_UPDATE\]/i;

/** The emotion block a reply ends with, as the model wrote it, so the reply that stands for it can carry it on. */
export function emotionBlockOf(reply: string): string {
    return reply.match(EMOTION_BLOCK)?.[0] ?? '';
}

/** A reply as its person reads it: without the model's thinking, its emotion block, or a marker it repeated. */
export function privateBodyOf(reply: string): string {
    return reply
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/\[EMOTION_UPDATE\][\s\S]*?\[\/EMOTION_UPDATE\]/gi, '')
        .replace(/\[EMOTION_UPDATE\][\s\S]*$/i, '')
        .split(PRIVATE_MARKER)
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * The text with its plain letters in capitals and everything else as written, so a place found in it is the same place
 * in the text itself. (Upper-casing the whole text can make it longer: "ß" becomes "SS".)
 */
const upperAscii = (text: string): string => text.replace(/[a-z]+/g, (letters) => letters.toUpperCase());

/**
 * Reads a reply as it is written and holds back anything that could be the start of the marker, so no part of the
 * marker is ever shown, wherever in the reply the model put it. Once the marker is found, nothing more goes on.
 */
export class MarkerWatch {
    private held = '';
    private seen = false;
    private written = '';

    /** The model asked to answer this person alone. */
    get found(): boolean {
        return this.seen;
    }

    /** What the model wrote after the marker: shown to nobody, read only for its emotion block. */
    get after(): string {
        return this.written;
    }

    /** The part of what was written so far that may go on to everyone. */
    push(text: string): string {
        if (this.seen) {
            this.written += text;
            return '';
        }
        const all = this.held + text;
        const at = upperAscii(all).indexOf(PRIVATE_MARKER);
        if (at >= 0) {
            this.seen = true;
            this.held = '';
            this.written = all.slice(at + PRIVATE_MARKER.length);
            return all.slice(0, at);
        }
        // Keep the longest ending that could still turn into the marker
        let keep = Math.min(all.length, PRIVATE_MARKER.length - 1);
        while (keep > 0 && !PRIVATE_MARKER.startsWith(upperAscii(all.slice(all.length - keep)))) keep--;
        this.held = all.slice(all.length - keep);
        return all.slice(0, all.length - keep);
    }

    /** The reply (or this part of it, before a tool) ended: what was held was not the marker after all. */
    rest(): string {
        const rest = this.seen ? '' : this.held;
        this.held = '';
        return rest;
    }
}

interface KeptReply {
    id: string;
    text: string;
    at: number;
    /** Handed on for the one copy in the person's direct messages with the bot. */
    copied?: boolean;
}

/**
 * Where the one copy of such an answer is kept: the person's direct messages with the bot, so they find it there and
 * carry on from it ("Continue privately"). Nothing is made twice: it is the same words, sent on. Neither call throws.
 */
export interface PrivateAnswerCopies {
    /** Keep this answer in the direct chat of this bot and the person with this chat address, once. */
    keep(botId: string, chatId: string, text: string): void;
    /**
     * The person opened their direct chat with the bot from an answer, and their device says it is this room. It is
     * checked to be theirs and the bot's before anything goes there.
     */
    opened(botId: string, chatId: string, roomId: string): void;
}

/** A Matrix room id, as a device names the direct chat it opened. */
const ROOM_ID = /^![^\s:]{1,200}:[^\s]{1,200}$/;

/** The room "Continue privately" names, when that is what was tapped; null for every other tap. */
export function continuedIn(tap: string): string | null {
    try {
        const said = JSON.parse(tap) as { action?: unknown; room?: unknown } | null;
        if (!said || said.action !== 'continue' || typeof said.room !== 'string') return null;
        return ROOM_ID.test(said.room) ? said.room : null;
    } catch {
        return null;
    }
}

/**
 * The replies only one person saw, for every bot of this server. A reply is a private event the game passes to that
 * person alone, so nobody else's device ever holds it. Kept a while by who the person is, so a reload (or walking back)
 * brings theirs back, as it does for a card's replies (#1658). A guest has no lasting id: theirs is sent once.
 */
export class PrivateAnswers {
    private readonly kept = new Map<string, KeptReply[]>();
    /** Whose last reply here was a private one, so the fixed line is not said again on every turn. */
    private readonly lastWasPrivate = new Set<string>();
    private count = 0;
    private copies: PrivateAnswerCopies | undefined;

    constructor(private readonly now: () => number = Date.now) {}

    /** Where signed-in people find these answers again (their direct messages). Without it they are only in nearby chat. */
    keepCopiesIn(copies: PrivateAnswerCopies | undefined): void {
        this.copies = copies;
    }

    private static where(botId: string, spaceName: string, who: string | number): string {
        return JSON.stringify([botId, spaceName, who]);
    }

    /**
     * Sends a reply to this person alone. False when it could not go (the bot is no longer in the space): then nothing
     * was shown to anyone. It is addressed to that one person in that one space, so if they have left nobody gets it,
     * and someone signed in finds it when they are back.
     */
    send(bot: AnswersBot, spaceName: string, playerId: number, text: string): boolean {
        if (!text.trim()) return false;
        const id = `p${this.now().toString(36)}${(this.count++).toString(36)}`;
        if (!bot.sendAskEvent(spaceName, playerId, { kind: 'reply', id, revision: 0, body: text })) return false;
        const person = bot.getPersonForArtifacts(playerId);
        if (person.signedIn && person.identifier) {
            const key = PrivateAnswers.where(bot.getBotId(), spaceName, person.identifier);
            const recent = (this.kept.get(key) ?? []).filter((reply) => this.now() - reply.at <= KEPT_MS).slice(-(KEPT - 1));
            const reply: KeptReply = { id, text, at: this.now() };
            this.kept.delete(key);
            this.kept.set(key, [...recent, reply]);
            if (this.kept.size > MAX_KEPT_FOR) this.kept.delete(this.kept.keys().next().value as string);
            this.copy(bot, playerId, [reply]);
        }
        return true;
    }

    /**
     * Hands these answers on for the person's direct messages, each once. Only for someone signed in whose chat address
     * the game vouches for: a guest has no direct messages, and gets the reply in nearby chat alone.
     */
    private copy(bot: AnswersBot, playerId: number, replies: KeptReply[]): string | undefined {
        const chatId = bot.chatIdOf?.(playerId);
        if (!chatId || !this.copies) return undefined;
        for (const reply of replies) {
            if (reply.copied) continue;
            reply.copied = true;
            this.copies.keep(bot.getBotId(), chatId, reply.text);
        }
        return chatId;
    }

    /**
     * The person tapped "Continue privately" and their direct chat with the bot is open. Any answer of theirs that was
     * not handed on yet (the game had not vouched for their chat address when it was made) is now, and the bot's side of
     * direct messages is told which chat it is.
     */
    continued(bot: AnswersBot, spaceName: string, playerId: number, roomId: string): void {
        const person = bot.getPersonForArtifacts(playerId);
        if (!person.signedIn || !person.identifier) return;
        const key = PrivateAnswers.where(bot.getBotId(), spaceName, person.identifier);
        const recent = (this.kept.get(key) ?? []).filter((reply) => this.now() - reply.at <= KEPT_MS);
        const chatId = this.copy(bot, playerId, recent);
        if (chatId) this.copies?.opened(bot.getBotId(), chatId, roomId);
    }

    /** The person is in the space again: their replies come back on their screen, in the order they were made. */
    personBack(bot: AnswersBot, spaceName: string, playerId: number): void {
        const person = bot.getPersonForArtifacts(playerId);
        if (!person.signedIn || !person.identifier) return;
        const key = PrivateAnswers.where(bot.getBotId(), spaceName, person.identifier);
        const recent = (this.kept.get(key) ?? []).filter((reply) => this.now() - reply.at <= KEPT_MS);
        if (recent.length === 0) return void this.kept.delete(key);
        for (const reply of recent) bot.sendAskEvent(spaceName, playerId, { kind: 'reply', id: reply.id, revision: 0, body: reply.text });
    }

    /** Whether this person's last reply from this bot here went to them alone: the fixed line was just said. */
    justAnsweredPrivately(botId: string, spaceName: string, playerId: number): boolean {
        return this.lastWasPrivate.has(PrivateAnswers.where(botId, spaceName, playerId));
    }

    /** What kind of reply this person just got here. */
    answered(botId: string, spaceName: string, playerId: number, privately: boolean): void {
        const key = PrivateAnswers.where(botId, spaceName, playerId);
        if (privately) {
            this.lastWasPrivate.delete(key);
            this.lastWasPrivate.add(key);
            if (this.lastWasPrivate.size > MAX_KEPT_FOR) this.lastWasPrivate.delete(this.lastWasPrivate.values().next().value as string);
        } else {
            this.lastWasPrivate.delete(key);
        }
    }
}
