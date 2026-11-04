/**
 * ToolApprovals: the card a bot shows in a direct message before a tool that asks first runs, and what each tap does
 * (game #1657, mock 3 approved 4 Nov 2026; Orbit #739 keeps the action).
 *
 * The tool is not held while the card waits. The gate says "ask", the exact call is saved in Orbit and shown on a card,
 * and the model is told it is waiting for the person's OK, so the reply ends and the chat stays free. A tap names only the
 * card and the revision it saw; Orbit decides who wins. An approval runs the arguments that were saved, once: Orbit's claim
 * lets one dispatcher start it, the gate is asked again right before the call, and how it ended is what Orbit is told.
 *
 *  - "Create" (approve) and "Create, and allow more…" (approve and remember) run it; "Don't create" closes it.
 *  - X closes the card and nothing is done. More time gives it another full wait. Review again makes a fresh card from the
 *    saved call, after the checks run again. Ask me again ends what "allow more" remembered.
 *  - Sending anything else closes the person's waiting cards: a typed "yes" never approves.
 *  - What went out and got no answer is "may have run": it is never sent again, and the person is told to check.
 *
 * The card and where it sits are kept in this process; after a restart the saved action still takes its tap, and the card
 * is shown again as a new notice instead of being edited.
 */
import { askEdit, askNotice, argumentLines, buildAsk, cardTitle, outcomeOf, rememberOffer, resultLine, type AskAnswer, type AskDecision, type AskField, type CardFacts, type ParsedTap } from './ApprovalCard';
import { acceptLine, fallbackLine, nameForLine, WORDS_SYSTEM, wordsPrompt, type Moment } from './NearbyWords';
import type { GateCall, GateDecision, ToolGate } from './ToolGate';
import type { ToolServerEntry } from './MCPConnector';
import { DEFAULT_CARD_SETTINGS, OrbitActionsUnavailable, type CardSettings, type OrbitActions, type SavedAction } from './OrbitActions';
import type { QuestionField } from './QuestionCard';
import type { Asked, AskInput, QuestionCards } from './QuestionCards';
import { batchWords, MakeCounts, type BatchKind } from './ToolQuantity';

/** How long a remembered approval lasts. Recommended values; the bot server's owner can change them. */
export const GRANT_IDLE_MINUTES = Math.max(1, Number(process.env.BOT_GRANT_IDLE_MINUTES) || 60);
export const GRANT_ABSOLUTE_MINUTES = Math.max(GRANT_IDLE_MINUTES, Number(process.env.BOT_GRANT_ABSOLUTE_MINUTES) || 8 * 60);

const MAX_CARDS = 2000;

/**
 * Where the card goes in nearby chat and voice (#1658): to the person who asked and nobody else. What everyone reads, and a
 * voice bot says aloud, is one plain line (`say`); the card, its endings and replies only they need go to them alone.
 */
export interface NearbySurface {
    /** The card, or the card as it ended, to this person alone. Throws when the person is no longer in the bubble. */
    card(botId: string, spaceName: string, person: Asker, ask: AskField | QuestionField): Promise<void>;
    /** A reply only this person needs: shown to them alone and never said aloud. Its id is the same each time it is sent again. */
    reply(botId: string, spaceName: string, person: Asker, text: string, id: string): Promise<void>;
    /** One line everyone in the bubble reads, and hears from a voice bot. */
    say(botId: string, spaceName: string, line: string): Promise<void>;
    /** The extra AI reply that words a line from the tool's title and the name only. Null when it fails. */
    write(botId: string, system: string, prompt: string): Promise<string | null>;
}

/** Where the card goes: the person's direct message with the bot. */
export interface CardSurface {
    /** Sends a notice and answers its event id. */
    send(botId: string, roomId: string, content: Record<string, unknown>): Promise<string>;
    /** Says a short plain line in the chat. */
    say(botId: string, roomId: string, text: string): Promise<void>;
}

/** Finding and running the tool a saved action names, the way a reply does. */
export interface ToolRunner {
    find(botId: string, toolName: string): Promise<ToolServerEntry | null>;
    run(botId: string, entry: ToolServerEntry, toolName: string, args: Record<string, unknown>, playerUuid: string): Promise<unknown>;
}

export interface Asker {
    uuid: string;
    name?: string | null;
    /** Their chat ID and whether they are a guest, when a tap in the chat told us (a reply to them needs both). */
    matrixUserId?: string;
    isGuest?: boolean;
    /** Set when the person is in a bubble with the bot (nearby chat and voice): the card then reaches only them (#1658). */
    playerId?: number;
}

/** What the bot says once an approved action ended, so the person hears what happened in the bot's own words. */
export interface Outcome {
    botId: string;
    roomId: string;
    person: Asker;
    title: string;
    /** done: it ran and answered. unknown: it may have run. failed: it did not work. */
    state: 'done' | 'unknown' | 'failed';
    result?: string;
}

export interface ApprovalDeps {
    orbit: OrbitActions;
    cards: CardSurface;
    /** Nearby chat and voice. Without it a call that asks first in a bubble is not run. */
    nearby?: NearbySurface;
    gate: Pick<ToolGate, 'decide'>;
    tools: ToolRunner;
    /** The question cards (#1661): taps on them, and what the person types or says while one waits, are theirs. */
    questions?: QuestionCards;
    /** The bot tells the person how an approved action ended. Never throws. */
    followUp?: (outcome: Outcome) => Promise<void>;
    now?: () => number;
}

export interface ProposeInput {
    botId: string;
    roomId: string;
    person: Asker;
    toolName: string;
    toolTitle?: string;
    entry: ToolServerEntry;
    args: Record<string, unknown>;
    decision: Extract<GateDecision, { kind: 'ask' }>;
    /** Always show a card, even when a remembered approval covers the call (the person tapped Review again). */
    cardOnly?: boolean;
    /** The card is the one before making more than the bot's limit (#1662): its own words, and nothing is remembered from it. */
    batch?: BatchKind;
}

export type Proposed =
    /** A remembered approval covers this call: run it now. */
    | { kind: 'run' }
    /** The card is shown. What the model is told; in a bubble also the line everyone reads, for the bot to say as its reply. */
    | { kind: 'waiting'; result: Record<string, unknown>; line?: string }
    /** The card could not be shown, so nothing was done. What the model is told. */
    | { kind: 'failed'; result: Record<string, unknown> };

interface Card {
    botId: string;
    roomId: string;
    person: Asker;
    facts: CardFacts;
    /** The notice the card is in; absent when this process did not send it. */
    eventId?: string;
    /** Whether the action still waits for a tap. */
    waiting: boolean;
    /** In a bubble (#1658): the card went to the person alone, and its ending is one line for everyone. */
    nearby: boolean;
    /** The line for how it ended has been said, so no ending is said twice. */
    said?: boolean;
    /** Says "no answer" for a card nobody answered in a bubble. */
    timer?: ReturnType<typeof setTimeout>;
    /** How the card ended, as it was last drawn. */
    lastAnswer?: AskAnswer;
    /** The person wrote again and Orbit is being asked to close it: a new call is not folded into it. */
    closing?: boolean;
    /** The card before making more than the limit (#1662), kept so Review again shows the same one. */
    batch?: BatchKind;
    /** What a bubble's lines call this card when its title holds an amount: the tool's own title. */
    lineTitle?: string;
}

const WAITING_RESULT = {
    status: 'waiting_for_ok',
    message:
        "A card asking for the person's OK was shown in this chat. Nothing was done yet. Say in one short line what you asked them to confirm, " +
        'and do not ask again or call the tool again: wait for them to tap. If they type something else instead, the card closes and nothing is done.',
};

/** The same, in a bubble: the line everyone reads is the bot's whole reply, and nothing from the card goes in it. */
const WAITING_NEARBY_RESULT = {
    status: 'waiting_for_ok',
    message:
        "A card asking for the person's OK was shown to them alone, and the chat was told in one line. Nothing was done yet. " +
        'Write nothing more about it: other people can read this chat, and the card is private. Do not call the tool again.',
};

/** What the model is told when a card could not be shown: no OK, no action. */
const NO_CARD_RESULT = { error: "The card asking for the person's OK could not be shown, so this was not done. Tell them to try again in a moment." };

export class ToolApprovals {
    private readonly cards = new Map<string, Card>();
    private readonly dispatching = new Set<string>();
    private readonly proposing = new Map<string, Promise<Proposed>>();
    /** A person's card in a bubble that closed because they said something else: a new card for the same tool is a change (#1658). */
    private readonly changing = new Map<string, number>();
    /** The replies only a person saw in a bubble, kept a while so they come back with the person after a reload (#1658). */
    private readonly replies = new Map<string, Array<{ id: string; text: string; at: number }>>();
    private replyCount = 0;
    /** People who allowed more in a bubble, so their messages there keep it alive without asking Orbit every time. */
    private readonly remembering = new Set<string>();
    /** How many things each request has made so far (#1662). */
    private readonly made: MakeCounts;
    private readonly now: () => number;

    constructor(private readonly deps: ApprovalDeps) {
        this.now = deps.now ?? Date.now;
        this.made = new MakeCounts(this.now);
    }

    /* ------------------------------------ the card ------------------------------------ */

    /** A call the gate says needs an OK: a remembered approval that covers it, or a card. Never throws. */
    async propose(input: ProposeInput): Promise<Proposed> {
        // The same call asked for twice at the same moment (a model repeating itself in one round) is one question
        const key = JSON.stringify([input.botId, input.roomId, input.person.uuid, input.toolName, input.args, input.decision.fingerprint, input.decision.heading, input.decision.notReviewed, !!input.cardOnly, input.batch ?? null]);
        const running = this.proposing.get(key);
        if (running) return running;
        const run = this.proposeNow(input).finally(() => {
            if (this.proposing.get(key) === run) this.proposing.delete(key);
        });
        this.proposing.set(key, run);
        return run;
    }

    private async proposeNow(input: ProposeInput): Promise<Proposed> {
        const { botId, roomId, person, entry, toolName, args, decision } = input;
        const nearby = person.playerId !== undefined;
        if (nearby && !this.deps.nearby) return { kind: 'failed', result: NO_CARD_RESULT };
        const base = {
            requesterKey: person.uuid,
            conversationKey: conversationKeyOf(roomId, nearby),
            connectionRef: entry.serverId,
            toolName,
            heading: decision.heading,
            toolFingerprint: decision.fingerprint,
            policyRevision: decision.policyRevision,
            arguments: args,
        };
        try {
            // The same call asked for again while its card still waits (a turn asked again, or the model repeating itself)
            // is that card: no second card, so one tap can never run it twice
            if (this.findWaiting(botId, roomId, person.uuid, toolName, args, decision)) return { kind: 'waiting', result: nearby ? WAITING_NEARBY_RESULT : WAITING_RESULT };
            // Making more than the limit is asked every time: nothing allowed before covers it
            if (!input.cardOnly && !input.batch && !decision.notReviewed && decision.heading !== 'deletesOrSends') {
                const grant = await this.deps.orbit.findGrant(botId, base);
                if (grant) return { kind: 'run' };
            }
            const wait = (await this.deps.orbit.cardSettings(botId)).cardWaitMinutes;
            const offer = input.batch ? null : rememberOffer(args, decision.heading, decision.notReviewed);
            const words = input.batch ? batchWords(input.batch) : null;
            const action = await this.deps.orbit.create(botId, {
                ...base,
                proposalKey: randomKey(),
                rememberScope: offer?.scope ?? null,
                reviewMinutes: wait,
            });
            const facts: CardFacts = {
                action,
                title: words ? cardTitle(words.title) : cardTitle(toolName, input.toolTitle),
                ...(entry.serverName ? { actsAs: entry.serverName } : {}),
                lines: [...(words?.lines ?? []), ...argumentLines(args, entry.inputSchema)],
                offer,
                notReviewed: decision.notReviewed,
                waitMinutes: wait,
                ...(words ? { buttons: { approve: words.approve, decline: words.decline } } : {}),
            };
            const card: Card = { botId, roomId, person, facts, waiting: true, nearby, ...(input.batch ? { batch: input.batch, lineTitle: cardTitle(toolName, input.toolTitle) } : {}) };
            try {
                card.eventId = await this.sendCard(card, buildAsk(facts, this.now()), false);
            } catch (error) {
                // No card, no OK: the saved action is closed so a tap can never find it
                console.warn(`[ToolApprovals] Could not show the card for ${toolName}:`, errorText(error));
                await this.deps.orbit.cancel(botId, action.id, { actorKey: person.uuid, revision: action.revision }).catch(() => undefined);
                return { kind: 'failed', result: NO_CARD_RESULT };
            }
            this.keep(action.id, card);
            if (!nearby) return { kind: 'waiting', result: WAITING_RESULT };
            this.scheduleExpiry(action.id, card);
            // One line for everyone: the bot needs an OK, or it changed what it asks (the person said something else)
            const moment: Moment = this.takeChange(botId, roomId, person.uuid, toolName) ? 'changed' : 'ask';
            return { kind: 'waiting', result: WAITING_NEARBY_RESULT, line: await this.lineFor(card, moment) };
        } catch (error) {
            console.warn(`[ToolApprovals] Could not ask for an OK for ${toolName}:`, errorText(error));
            return { kind: 'failed', result: NO_CARD_RESULT };
        }
    }

    private findWaiting(botId: string, roomId: string, requesterKey: string, toolName: string, args: Record<string, unknown>, decision: Extract<GateDecision, { kind: 'ask' }>): Card | undefined {
        const wanted = JSON.stringify(args);
        for (const card of this.cards.values()) {
            const action = card.facts.action;
            if (!card.waiting || card.closing || card.botId !== botId || card.roomId !== roomId || card.person.uuid !== requesterKey) continue;
            if (action.toolName !== toolName || action.toolFingerprint !== decision.fingerprint || action.heading !== decision.heading || card.facts.notReviewed !== decision.notReviewed) continue;
            if (!(Date.parse(action.reviewExpiresAt) > this.now())) continue;
            if (JSON.stringify(action.arguments) === wanted) return card;
        }
        return undefined;
    }

    private keep(id: string, card: Card): void {
        this.cards.delete(id);
        this.cards.set(id, card);
        while (this.cards.size > MAX_CARDS) {
            const oldest = this.cards.keys().next().value;
            if (oldest === undefined) break;
            this.cards.delete(oldest);
        }
    }

    /** Redraws the card at the action's revision with how it ended (or none, while it waits). */
    private async redraw(id: string, card: Card, action: SavedAction | undefined, answer?: AskAnswer): Promise<void> {
        if (action) card.facts = { ...card.facts, action };
        // What it ended with, for a person who comes back to the bubble (#1658)
        card.lastAnswer = answer;
        const ask: AskField = buildAsk(card.facts, this.now(), answer);
        try {
            if (card.eventId) {
                await this.sendCard(card, ask, true);
            } else {
                // This process did not send the card (it restarted since): the ended card goes in as a new notice
                card.eventId = await this.sendCard(card, ask, false);
            }
        } catch (error) {
            console.warn(`[ToolApprovals] Could not update the card ${id}:`, errorText(error));
        }
    }

    /** The card for an action this process has not seen, from what Orbit saved. */
    private async rebuild(botId: string, roomId: string, person: Asker, id: string): Promise<{ card: Card; action: SavedAction } | null> {
        const action = await this.deps.orbit.read(botId, id);
        const nearby = person.playerId !== undefined;
        if (!action || action.requesterKey !== person.uuid || action.conversationKey !== conversationKeyOf(roomId, nearby)) return null;
        const wait = (await this.deps.orbit.cardSettings(botId)).cardWaitMinutes;
        const entry = await this.deps.tools.find(botId, action.toolName).catch(() => null);
        const facts: CardFacts = {
            action,
            title: cardTitle(action.toolName),
            ...(entry?.serverName ? { actsAs: entry.serverName } : {}),
            lines: argumentLines(action.arguments, entry?.inputSchema),
            offer: action.rememberScope ? { scope: action.rememberScope, phrase: '' } : null,
            notReviewed: false,
            waitMinutes: wait,
        };
        const card: Card = { botId, roomId, person, facts, waiting: action.status === 'waiting', nearby };
        this.keep(id, card);
        return { card, action };
    }

    /* -------------------------------------- taps -------------------------------------- */

    /**
     * One tap from the person in this chat. Orbit says who wins; what the card then shows follows Orbit's answer. Never
     * throws. A tap on a card of someone else's, or of another chat, does nothing.
     */
    async handleTap(botId: string, roomId: string, person: Asker, tap: ParsedTap): Promise<void> {
        try {
            // A question card is not an action Orbit keeps: its taps are the question cards' own (#1661)
            if (await this.deps.questions?.handleTap(botId, roomId, person, tap)) return;
            // A pick belongs to a question card, never to an approval
            if (tap.tap.action === 'pick') return;
            let card = this.cards.get(tap.ask);
            if (card && (card.botId !== botId || card.roomId !== roomId || card.person.uuid !== person.uuid)) return;
            if (!card) {
                const rebuilt = await this.rebuild(botId, roomId, person, tap.ask);
                if (!rebuilt) return;
                card = rebuilt.card;
            }
            // Who tapped, as the chat knows them: the bot's words afterwards go to them
            card.person = person;
            const actorKey = person.uuid;
            const { orbit } = this.deps;
            const id = tap.ask;

            switch (tap.tap.action) {
                case 'decide': {
                    const option: AskDecision = tap.tap.option;
                    const answer = await orbit.decide(botId, id, {
                        actorKey,
                        revision: tap.revision,
                        decision: option,
                        ...(option === 'approveAndRemember' ? { idleMinutes: GRANT_IDLE_MINUTES, absoluteMinutes: GRANT_ABSOLUTE_MINUTES } : {}),
                    });
                    // A 409 that is not an answer about this action (no action in it) is a tap that did not count
                    if (!answer.action) return void (await this.tell(botId, roomId, person, "I couldn't record that. Tap again in a moment."));
                    if (answer.outcome === 'already_decided' && answer.action.status === 'approved' && option !== 'decline') {
                        // Approved, but nobody started it: the answer to an earlier tap was lost, or this server restarted in between.
                        // Orbit lets one dispatcher win, so starting it here again can't run it twice.
                        card.waiting = false;
                        void this.dispatch(id, card, answer.action, 'approve');
                        return;
                    }
                    if (answer.outcome !== 'decided') return void (await this.redrawFor(id, card, answer.action));
                    card.waiting = false;
                    if (option === 'decline') {
                        await this.redraw(id, card, answer.action, { option: 'decline' });
                        return void (await this.endLine(card, 'notDone'));
                    }
                    const allowedMore = option === 'approveAndRemember' && answer.grantId ? allowedMoreLine() : undefined;
                    if (allowedMore && card.nearby) this.remembering.add(JSON.stringify([botId, roomId, person.uuid]));
                    // The tap is recorded; running it takes as long as the tool does, so it does not hold the chat
                    void this.dispatch(id, card, answer.action, option, allowedMore);
                    return;
                }
                case 'close': {
                    const answer = await orbit.cancel(botId, id, { actorKey, revision: tap.revision });
                    card.waiting = false;
                    if (answer.outcome === 'changed') {
                        await this.redraw(id, card, answer.action, { closed: true });
                        await this.endLine(card, 'notDone');
                    } else if (answer.action) await this.redrawFor(id, card, answer.action);
                    return;
                }
                case 'moreTime': {
                    const wait = (await orbit.cardSettings(botId)).cardWaitMinutes;
                    const answer = await orbit.extend(botId, id, { actorKey, revision: tap.revision, reviewMinutes: wait });
                    if (answer.outcome === 'changed') {
                        await this.redraw(id, card, answer.action);
                        this.scheduleExpiry(id, card);
                    } else if (answer.outcome === 'no_more_time') await this.tell(botId, roomId, person, 'This card cannot wait any longer. Tap Review again, or ask me again.');
                    else if (answer.action) await this.redrawFor(id, card, answer.action);
                    return;
                }
                case 'reviewAgain':
                    return void (await this.reviewAgain(id, card));
                case 'askAgain': {
                    await orbit.revokeGrants(botId, { requesterKey: actorKey, conversationKey: conversationKeyOf(roomId, card.nearby), reason: 'ask_again' });
                    const action = card.facts.action;
                    // Same card, without "allow more": the next call asks again
                    await this.redraw(id, card, { ...action, revision: action.revision + 1 }, { option: 'approveAndRemember' });
                    return;
                }
            }
        } catch (error) {
            console.warn(`[ToolApprovals] Could not take the tap on ${tap.ask}:`, errorText(error));
            if (error instanceof OrbitActionsUnavailable) {
                await this.tell(botId, roomId, person, "I couldn't record that. Tap again in a moment.").catch(() => undefined);
            }
        }
    }

    /** A card whose tap lost: it shows what the action is now. */
    private async redrawFor(id: string, card: Card, action: SavedAction): Promise<void> {
        card.waiting = action.status === 'waiting';
        await this.redraw(id, card, action, action.status === 'waiting' ? undefined : answerFor(action));
    }

    /** "Review again": a fresh card from the saved call, once the checks pass again. */
    private async reviewAgain(id: string, card: Card): Promise<void> {
        const { botId, roomId, person } = card;
        const action = await this.deps.orbit.read(botId, id);
        if (!action || action.requesterKey !== person.uuid || action.status !== 'closed' || action.closedReason === 'declined') return;
        const entry = await this.deps.tools.find(botId, action.toolName);
        const stale = !entry || entry.fingerprint !== action.toolFingerprint;
        const checked = stale ? null : await this.deps.gate.decide(gateCall(botId, action.toolName, entry, person));
        // A card before making more than the limit comes from a tool that runs right away: it asks again as it did
        const decision: GateDecision | null =
            card.batch && checked?.kind === 'run' && checked.heading === 'makesNew' && checked.policyRevision !== undefined && checked.fingerprint
                ? { kind: 'ask', heading: 'makesNew', notReviewed: false, policyRevision: checked.policyRevision, fingerprint: checked.fingerprint }
                : checked;
        if (!entry || !decision || decision.kind !== 'ask') {
            const why = decision?.kind === 'refuse' ? decision.line : 'That changed since, so I need you to ask me again.';
            await this.tell(botId, roomId, person, why);
            return;
        }
        const proposed = await this.propose({
            botId,
            roomId,
            person,
            toolName: action.toolName,
            toolTitle: entry.title,
            entry,
            args: action.arguments,
            decision,
            cardOnly: true,
            ...(card.batch ? { batch: card.batch } : {}),
        });
        if (proposed.kind === 'failed') await this.tell(botId, roomId, person, "I couldn't show the card. Try again in a moment.");
        // In a bubble there is no reply to carry the line, so it is said here
        else if (proposed.kind === 'waiting' && proposed.line) await this.say(card, proposed.line);
    }

    /* ------------------------------------- running ------------------------------------- */

    /** Runs an approved action once: claim, check again, call the tool, say how it ended. Never throws. */
    private async dispatch(id: string, card: Card, approved: SavedAction, option: AskDecision, allowedMore?: string): Promise<void> {
        if (this.dispatching.has(id)) return;
        this.dispatching.add(id);
        const { botId, roomId, person } = card;
        const picked: AskAnswer = { option, ...(allowedMore ? { allowedMore } : {}) };
        const title = card.facts.title;
        // Set right before the tool is called: until then, whatever stops this run, the tool did not run
        let started = false;
        let attempt: { attemptId: string; action: SavedAction } | null = null;
        try {
            const claim = await this.deps.orbit.claim(botId, id);
            if (!claim.claimed) {
                // Nobody started it in time (or another dispatcher did): the card shows what it is now
                if (claim.action) await this.redrawFor(id, card, claim.action);
                return;
            }
            const action = claim.action;
            attempt = { attemptId: claim.attemptId, action };
            const finish = async (outcome: Parameters<OrbitActions['finish']>[2]['outcome'], answer: AskAnswer, followUp?: Outcome['state'], result?: string) => {
                const done = await this.deps.orbit.finish(botId, id, { attemptId: claim.attemptId, outcome }).catch((error) => {
                    console.warn(`[ToolApprovals] Could not tell Orbit how ${id} ended:`, errorText(error));
                    return null;
                });
                await this.redraw(id, card, done ?? action, { ...picked, ...answer });
                if (followUp) await this.afterRun(card, { botId, roomId, person, title, state: followUp, ...(result ? { result } : {}) });
            };

            // The checks that count are the ones right before the call: the tool, the person and the settings as they are now
            const entry = await this.deps.tools.find(botId, action.toolName).catch(() => null);
            const verdict = entry && entry.fingerprint === action.toolFingerprint ? await this.deps.gate.decide(gateCall(botId, action.toolName, entry, person)) : null;
            if (!entry || !verdict) return void (await finish('notSent', { result: 'The tool changed since, so nothing was done.' }, 'failed'));
            if (verdict.kind === 'refuse') return void (await finish('notSent', { result: verdict.line }, 'failed'));
            // A card before making more than the limit comes from a tool that runs right away, so its verdict is a run
            const judged = verdict.kind === 'ask' ? verdict.policyRevision : card.batch && verdict.kind === 'run' ? verdict.policyRevision : undefined;
            if (judged !== undefined && judged !== action.policyRevision) {
                return void (await finish('notSent', { result: 'The settings changed since, so nothing was done.' }, 'failed'));
            }

            started = true;
            // What this tap lets be made counts in the request, so a later step doesn't ask again for the same ones
            if (card.batch && (card.batch.kind === 'over' || card.batch.kind === 'part')) this.made.add(this.countKey(botId, roomId, person), card.batch.count);
            const result = await this.deps.tools.run(botId, entry, action.toolName, action.arguments, person.uuid);
            const outcome = outcomeOf(result);
            if (outcome === 'succeeded') {
                const line = resultLine(result);
                return void (await finish('succeeded', line ? { result: line } : {}, 'done', line));
            }
            if (outcome === 'uncertain') return void (await finish('uncertain', { unknown: true }, 'unknown'));
            const why = errorLine(result);
            return void (await finish(outcome, { result: why }, 'failed', why));
        } catch (error) {
            console.warn(`[ToolApprovals] Running ${id} stopped:`, errorText(error));
            if (!started) {
                // Stopped before the tool was called: nothing was done, and Orbit is told if it had handed the call out
                const claimed = attempt as { attemptId: string; action: SavedAction } | null;
                const done = claimed ? await this.deps.orbit.finish(botId, id, { attemptId: claimed.attemptId, outcome: 'notSent' }).catch(() => null) : null;
                await this.redraw(id, card, done ?? claimed?.action, { ...picked, result: "I couldn't start this, so nothing was done. Ask me again." }).catch(() => undefined);
                await this.afterRun(card, { botId, roomId, person, title, state: 'failed', result: "It couldn't be started, so nothing was done." });
                return;
            }
            // It may have started: never send it again, and tell the person to check
            await this.redraw(id, card, undefined, { ...picked, unknown: true }).catch(() => undefined);
        } finally {
            this.dispatching.delete(id);
            card.waiting = false;
        }
    }

    /* ------------------------------- nearby chat and voice ------------------------------- */

    /** Shows the card, or the card as it ended: in a direct message the notice, in a bubble the person alone (#1658). */
    private async sendCard(card: Card, ask: AskField, edit: boolean): Promise<string> {
        if (card.nearby) {
            if (!this.deps.nearby) throw new Error('Nearby cards are not set up');
            await this.deps.nearby.card(card.botId, card.roomId, card.person, ask);
            // The game changes the card it has by its id, so the id is all that says it was sent
            return ask.id;
        }
        const content = edit && card.eventId ? askEdit(card.eventId, ask) : askNotice(ask);
        return this.deps.cards.send(card.botId, card.roomId, content);
    }

    /** A short plain line to the person alone: in a direct message in the chat, in a bubble a reply only they see. */
    private async tell(botId: string, roomId: string, person: Asker, text: string): Promise<void> {
        if (person.playerId !== undefined) {
            const id = `r${Date.now().toString(36)}${(this.replyCount++).toString(36)}`;
            const key = JSON.stringify([botId, roomId, person.uuid]);
            const kept = (this.replies.get(key) ?? []).filter((reply) => this.now() - reply.at <= REPLY_KEPT_MS).slice(-(REPLIES_KEPT - 1));
            this.replies.set(key, [...kept, { id, text, at: this.now() }]);
            if (this.replies.size > MAX_CARDS) this.replies.delete(this.replies.keys().next().value as string);
            return void (await this.deps.nearby?.reply(botId, roomId, person, text, id));
        }
        await this.deps.cards.say(botId, roomId, text);
    }

    /** One line everyone in the bubble reads and, from a voice bot, hears. Never throws. */
    private async say(card: Card, line: string): Promise<void> {
        try {
            await this.deps.nearby?.say(card.botId, card.roomId, line);
        } catch (error) {
            console.warn(`[ToolApprovals] Could not say a line in ${card.roomId}:`, errorText(error));
        }
    }

    /** The line for a moment: worded by one short extra AI reply that gets only the title and the name, else the title as it is. */
    private async lineFor(card: Card, moment: Moment): Promise<string> {
        const name = nameForLine(card.person.name);
        const title = card.lineTitle ?? card.facts.title;
        let written: string | null = null;
        try {
            written = acceptLine(await this.deps.nearby?.write(card.botId, WORDS_SYSTEM, wordsPrompt(moment, name, title)), name, card.facts.lines.map((line) => line.text), title);
        } catch {
            written = null;
        }
        return written ?? fallbackLine(moment, name, title);
    }

    /** How a card ended, for everyone in the bubble, once. The card itself already says it to the person who asked. */
    private async endLine(card: Card, moment: Extract<Moment, 'sent' | 'notDone'>): Promise<void> {
        if (!card.nearby || card.said) return;
        card.said = true;
        clearTimeout(card.timer);
        await this.say(card, await this.lineFor(card, moment));
    }

    /** After an approved action ran: a direct message's bot says how it ended in its own words; a bubble gets one plain line. */
    private async afterRun(card: Card, outcome: Outcome): Promise<void> {
        if (!card.nearby) return void (await this.deps.followUp?.(outcome).catch(() => undefined));
        // What the tool said stays on the card: the line holds only the title. A call that may have run says nothing it can't know.
        if (outcome.state === 'done') await this.endLine(card, 'sent');
        else if (outcome.state === 'failed') await this.endLine(card, 'notDone');
    }

    private takeChange(botId: string, roomId: string, personUuid: string, toolName: string): boolean {
        const key = changeKey(botId, roomId, personUuid, toolName);
        const at = this.changing.get(key);
        this.changing.delete(key);
        return at !== undefined && this.now() - at <= CHANGE_WINDOW_MS;
    }

    /** A card nobody answers in a bubble ends on its own: the card says so, and everyone reads one line. */
    private scheduleExpiry(id: string, card: Card): void {
        if (!card.nearby) return;
        clearTimeout(card.timer);
        const wait = Date.parse(card.facts.action.reviewExpiresAt) - this.now() + 1500;
        const timer = setTimeout(() => void this.expire(id, card), Math.min(Math.max(wait, 1000), 2 ** 31 - 1));
        timer.unref?.();
        card.timer = timer;
    }

    private async expire(id: string, card: Card): Promise<void> {
        if (!card.waiting) return;
        try {
            const action = await this.deps.orbit.read(card.botId, id);
            if (!action) return;
            if (action.status === 'waiting' && Date.parse(action.reviewExpiresAt) > this.now()) {
                // More time was given (from another device, or after a restart)
                card.facts = { ...card.facts, action };
                this.scheduleExpiry(id, card);
                return;
            }
            if (action.status !== 'waiting' && action.closedReason !== 'expired') {
                // Someone answered it meanwhile: the card shows what it is now
                await this.redrawFor(id, card, action);
                return;
            }
            card.waiting = false;
            await this.redraw(id, card, { ...action, revision: action.revision + 1 }, { expired: true });
            await this.endLine(card, 'notDone');
        } catch (error) {
            console.warn(`[ToolApprovals] Could not end the card ${id} that nobody answered:`, errorText(error));
        }
    }

    /**
     * The person said something in a bubble while a card waits for them (#1658): the label of its main button when what
     * they said is a yes, which never sends (only the tap does), else nothing. Nothing to answer when no card waits.
     */
    waitingLabel(botId: string, roomId: string, person: Asker): string | undefined {
        const card = this.waitingOf(botId, roomId, person)[0];
        return card?.facts.title ? cardOptionLabel(card) : undefined;
    }

    /** The cards of this person that still wait in this bubble, oldest first. */
    private waitingOf(botId: string, roomId: string, person: Asker): Card[] {
        return [...this.cards.values()].filter(
            (card) => card.nearby && card.waiting && card.botId === botId && card.roomId === roomId && card.person.uuid === person.uuid && Date.parse(card.facts.action.reviewExpiresAt) > this.now()
        );
    }

    /** The bot's own settings for cards (how it asks, and when): read once in a while, never throws, the recommended ones when Orbit can't be asked. */
    settings(botId: string): Promise<CardSettings> {
        return this.deps.orbit.cardSettings(botId).catch(() => ({ ...DEFAULT_CARD_SETTINGS }));
    }

    /* ----------------------------- how many a request has made (#1662) ----------------------------- */

    private countKey(botId: string, roomId: string, person: Asker): string {
        return JSON.stringify([botId, conversationKeyOf(roomId, person.playerId !== undefined), person.uuid]);
    }

    /** Whether `count` more fit under the limit for this person's request; if so they are counted now. Otherwise how many were made so far. */
    reserveMake(botId: string, roomId: string, person: Asker, count: number, limit: number): { ok: true } | { ok: false; soFar: number } {
        return this.made.reserve(this.countKey(botId, roomId, person), count, limit);
    }

    /** How many things this person's request has made so far. */
    madeSoFar(botId: string, roomId: string, person: Asker): number {
        return this.made.soFar(this.countKey(botId, roomId, person));
    }

    /** The person asked for something new: what the last request made is not counted against this one. */
    newRequest(botId: string, roomId: string, person: Asker): void {
        this.made.reset(this.countKey(botId, roomId, person));
    }

    /** Whether question cards are set up here at all. */
    get asksQuestions(): boolean {
        return !!this.deps.questions;
    }

    /** Shows a question card for the person (#1661). Never throws. */
    async askQuestion(input: AskInput): Promise<Asked> {
        if (!this.deps.questions) return { kind: 'failed', result: { error: 'The question card could not be shown, so nothing was asked. Ask in one short sentence in words instead.' } };
        return this.deps.questions.ask(input);
    }

    /**
     * The person said or typed something in a bubble (#1661): a question card waiting for them is answered by it, "out
     * loud" for a voice bot they spoke to. True when a card ended that way. Never throws.
     */
    async answerQuestionByMessage(botId: string, roomId: string, person: Asker, how: 'typed' | 'spoken'): Promise<boolean> {
        return ((await this.deps.questions?.onPersonMessage(botId, roomId, person, how)) ?? 0) > 0;
    }

    /** A reply only this person needs, never said aloud: the answer to a yes that never sends. Never throws. */
    async replyPrivately(botId: string, roomId: string, person: Asker, text: string): Promise<void> {
        try {
            await this.tell(botId, roomId, person, text);
        } catch (error) {
            console.warn(`[ToolApprovals] Could not reply privately in ${roomId}:`, errorText(error));
        }
    }

    /** The person wrote in a bubble where they allowed more: what they allowed lasts another stretch. Quiet when they allowed nothing. */
    touch(botId: string, roomId: string, person: Asker): void {
        if (!this.remembering.has(JSON.stringify([botId, roomId, person.uuid]))) return;
        void this.deps.orbit.touchGrants(botId, { requesterKey: person.uuid, conversationKey: conversationKeyOf(roomId, true) }).catch(() => undefined);
    }

    /**
     * The person is in the bubble again (they reloaded, or walked back): the cards that wait for them, the ones that ended
     * and the replies only they saw come back on their screen, in the order they were made (#1658). Never throws.
     */
    async personBack(botId: string, roomId: string, person: Asker): Promise<void> {
        await this.deps.questions?.personBack(botId, roomId, person);
        const key = JSON.stringify([botId, roomId, person.uuid]);
        for (const reply of (this.replies.get(key) ?? []).filter((kept) => this.now() - kept.at <= REPLY_KEPT_MS)) {
            await this.deps.nearby?.reply(botId, roomId, person, reply.text, reply.id).catch(() => undefined);
        }
        const mine = [...this.cards.entries()].filter(([, card]) => card.nearby && card.botId === botId && card.roomId === roomId && card.person.uuid === person.uuid);
        for (const [id, card] of mine) {
            try {
                const waiting = card.waiting && Date.parse(card.facts.action.reviewExpiresAt) > this.now();
                const ask = buildAsk(card.facts, this.now(), waiting ? undefined : card.lastAnswer ?? (card.waiting ? { expired: true } : undefined));
                if (!waiting && !ask.answer) continue;
                card.person = { ...card.person, playerId: person.playerId };
                await this.deps.nearby?.card(botId, roomId, card.person, ask);
            } catch (error) {
                console.warn(`[ToolApprovals] Could not show the card ${id} again:`, errorText(error));
            }
        }
    }

    /* ------------------------------ the person writes again ------------------------------ */

    /**
     * The person sent a message to the bot in this chat: their remembered approvals last another stretch, and a card still
     * waiting for them closes ("You typed something else, so nothing was done"). Another person's message never calls this.
     * Never throws.
     */
    async onPersonMessage(botId: string, roomId: string, person: Asker): Promise<void> {
        // A question card waiting for them is answered by what they wrote (#1661); their message goes on to the bot as it is
        await this.deps.questions?.onPersonMessage(botId, roomId, person, 'typed');
        // A new message is a new request: what the last one made doesn't count against it (#1662)
        this.newRequest(botId, roomId, person);
        const nearby = person.playerId !== undefined;
        const conversationKey = conversationKeyOf(roomId, nearby);
        void this.deps.orbit.touchGrants(botId, { requesterKey: person.uuid, conversationKey }).catch(() => undefined);
        const waiting = [...this.cards.entries()].filter(([, card]) => card.waiting && card.botId === botId && card.roomId === roomId && card.person.uuid === person.uuid);
        for (const [, card] of waiting) card.closing = true;
        try {
            // Orbit closes every card of theirs still waiting here, also ones this server no longer holds (after a restart)
            const closed = new Set(await this.deps.orbit.supersede(botId, { requesterKey: person.uuid, conversationKey }));
            for (const [id, card] of waiting) {
                if (!closed.has(id)) {
                    card.closing = false;
                    continue;
                }
                card.waiting = false;
                // In a bubble, a new card for the same tool soon after is a change, and everyone reads it as one (#1658)
                if (nearby) this.changing.set(changeKey(botId, roomId, person.uuid, card.facts.action.toolName), this.now());
                await this.redraw(id, card, { ...card.facts.action, status: 'closed', closedReason: 'superseded', revision: card.facts.action.revision + 1 }, { typed: true });
            }
        } catch (error) {
            // Not closed as far as anyone knows: these cards still wait
            for (const [, card] of waiting) card.closing = false;
            console.warn(`[ToolApprovals] Could not close the waiting cards in ${roomId}:`, errorText(error));
        }
    }
}

/* -------------------------------------- helpers -------------------------------------- */

/** A direct message's room, or a bubble's space: a card belongs to one or the other, never both. */
const conversationKeyOf = (roomId: string, nearby = false) => `${nearby ? 'near' : 'dm'}:${roomId}`;

const changeKey = (botId: string, roomId: string, personUuid: string, toolName: string) => JSON.stringify([botId, roomId, personUuid, toolName]);

/** The replies only a person saw come back with them after a reload for this long, and this many. */
const REPLY_KEPT_MS = 2 * 60 * 60_000;
const REPLIES_KEPT = 10;

/** The words on a card's main button: what the person taps to go ahead. */
function cardOptionLabel(card: Card): string | undefined {
    return buildAsk(card.facts, Date.now()).options.find((option) => option.id === 'approve')?.label;
}

/** How long after a person said something else a new card for the same tool still reads as a change. */
const CHANGE_WINDOW_MS = 5 * 60_000;

function randomKey(): string {
    return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function errorLine(result: unknown): string {
    const text = result && typeof result === 'object' ? (result as { error?: unknown }).error : undefined;
    return typeof text === 'string' && text ? text.slice(0, 300) : 'It did not work, so nothing was done.';
}

/** The gate's question for a saved call: the same person, in a direct message, with the tool as it is now. */
function gateCall(botId: string, toolName: string, entry: ToolServerEntry, person: Asker): GateCall {
    return {
        botId,
        toolName,
        ...(entry.title ? { toolTitle: entry.title } : {}),
        serverId: entry.serverId,
        ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
        person: { signedIn: true, identifier: person.uuid },
        voice: false,
    };
}

/** How long "allow more" lasts, in words. */
export function allowedMoreLine(): string {
    const hours = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`);
    return `Lasts until you stop writing for ${hours(GRANT_IDLE_MINUTES)}, or ${hours(GRANT_ABSOLUTE_MINUTES)} at most. Ask me again ends it.`;
}

/** What a card shows for an action that is already past waiting, from Orbit's own record of it. */
export function answerFor(action: SavedAction): AskAnswer {
    switch (action.status) {
        case 'closed':
            switch (action.closedReason) {
                case 'declined':
                    return { option: 'decline' };
                case 'cancelled':
                    return { closed: true };
                case 'superseded':
                    return { typed: true };
                default:
                    return { expired: true };
            }
        case 'couldntConfirm':
            return { option: 'approve', unknown: true };
        case 'failed':
            return { option: 'approve', result: 'It did not work, so nothing was done.' };
        default:
            // approved, running or done: someone's tap got there first
            return { option: 'approve' };
    }
}
