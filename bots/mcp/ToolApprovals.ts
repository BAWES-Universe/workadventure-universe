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
import type { GateCall, GateDecision, ToolGate } from './ToolGate';
import type { ToolServerEntry } from './MCPConnector';
import { OrbitActionsUnavailable, type OrbitActions, type SavedAction } from './OrbitActions';

/** How long a remembered approval lasts. Recommended values; the bot server's owner can change them. */
export const GRANT_IDLE_MINUTES = Math.max(1, Number(process.env.BOT_GRANT_IDLE_MINUTES) || 60);
export const GRANT_ABSOLUTE_MINUTES = Math.max(GRANT_IDLE_MINUTES, Number(process.env.BOT_GRANT_ABSOLUTE_MINUTES) || 8 * 60);

const MAX_CARDS = 2000;

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
    gate: Pick<ToolGate, 'decide'>;
    tools: ToolRunner;
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
}

export type Proposed =
    /** A remembered approval covers this call: run it now. */
    | { kind: 'run' }
    /** The card is shown. What the model is told. */
    | { kind: 'waiting'; result: Record<string, unknown> }
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
    /** The person wrote again and Orbit is being asked to close it: a new call is not folded into it. */
    closing?: boolean;
}

const WAITING_RESULT = {
    status: 'waiting_for_ok',
    message:
        "A card asking for the person's OK was shown in this chat. Nothing was done yet. Say in one short line what you asked them to confirm, " +
        'and do not ask again or call the tool again: wait for them to tap. If they type something else instead, the card closes and nothing is done.',
};

/** What the model is told when a card could not be shown: no OK, no action. */
const NO_CARD_RESULT = { error: "The card asking for the person's OK could not be shown, so this was not done. Tell them to try again in a moment." };

export class ToolApprovals {
    private readonly cards = new Map<string, Card>();
    private readonly dispatching = new Set<string>();
    private readonly proposing = new Map<string, Promise<Proposed>>();
    private readonly now: () => number;

    constructor(private readonly deps: ApprovalDeps) {
        this.now = deps.now ?? Date.now;
    }

    /* ------------------------------------ the card ------------------------------------ */

    /** A call the gate says needs an OK: a remembered approval that covers it, or a card. Never throws. */
    async propose(input: ProposeInput): Promise<Proposed> {
        // The same call asked for twice at the same moment (a model repeating itself in one round) is one question
        const key = JSON.stringify([input.botId, input.roomId, input.person.uuid, input.toolName, input.args, input.decision.fingerprint, input.decision.heading, input.decision.notReviewed, !!input.cardOnly]);
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
        const base = {
            requesterKey: person.uuid,
            conversationKey: conversationKeyOf(roomId),
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
            if (this.findWaiting(botId, roomId, person.uuid, toolName, args, decision)) return { kind: 'waiting', result: WAITING_RESULT };
            if (!input.cardOnly && !decision.notReviewed && decision.heading !== 'deletesOrSends') {
                const grant = await this.deps.orbit.findGrant(botId, base);
                if (grant) return { kind: 'run' };
            }
            const wait = (await this.deps.orbit.cardSettings(botId)).cardWaitMinutes;
            const offer = rememberOffer(args, decision.heading, decision.notReviewed);
            const action = await this.deps.orbit.create(botId, {
                ...base,
                proposalKey: randomKey(),
                rememberScope: offer?.scope ?? null,
                reviewMinutes: wait,
            });
            const facts: CardFacts = {
                action,
                title: cardTitle(toolName, input.toolTitle),
                ...(entry.serverName ? { actsAs: entry.serverName } : {}),
                lines: argumentLines(args, entry.inputSchema),
                offer,
                notReviewed: decision.notReviewed,
                waitMinutes: wait,
            };
            const card: Card = { botId, roomId, person, facts, waiting: true };
            try {
                card.eventId = await this.deps.cards.send(botId, roomId, askNotice(buildAsk(facts, this.now())));
            } catch (error) {
                // No card, no OK: the saved action is closed so a tap can never find it
                console.warn(`[ToolApprovals] Could not show the card for ${toolName}:`, errorText(error));
                await this.deps.orbit.cancel(botId, action.id, { actorKey: person.uuid, revision: action.revision }).catch(() => undefined);
                return { kind: 'failed', result: NO_CARD_RESULT };
            }
            this.keep(action.id, card);
            return { kind: 'waiting', result: WAITING_RESULT };
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
        const ask: AskField = buildAsk(card.facts, this.now(), answer);
        try {
            if (card.eventId) {
                await this.deps.cards.send(card.botId, card.roomId, askEdit(card.eventId, ask));
            } else {
                // This process did not send the card (it restarted since): the ended card goes in as a new notice
                card.eventId = await this.deps.cards.send(card.botId, card.roomId, askNotice(ask));
            }
        } catch (error) {
            console.warn(`[ToolApprovals] Could not update the card ${id}:`, errorText(error));
        }
    }

    /** The card for an action this process has not seen, from what Orbit saved. */
    private async rebuild(botId: string, roomId: string, person: Asker, id: string): Promise<{ card: Card; action: SavedAction } | null> {
        const action = await this.deps.orbit.read(botId, id);
        if (!action || action.requesterKey !== person.uuid || action.conversationKey !== conversationKeyOf(roomId)) return null;
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
        const card: Card = { botId, roomId, person, facts, waiting: action.status === 'waiting' };
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
                    if (!answer.action) return void (await this.deps.cards.say(botId, roomId, "I couldn't record that. Tap again in a moment."));
                    if (answer.outcome === 'already_decided' && answer.action.status === 'approved' && option !== 'decline') {
                        // Approved, but nobody started it: the answer to an earlier tap was lost, or this server restarted in between.
                        // Orbit lets one dispatcher win, so starting it here again can't run it twice.
                        card.waiting = false;
                        void this.dispatch(id, card, answer.action, 'approve');
                        return;
                    }
                    if (answer.outcome !== 'decided') return void (await this.redrawFor(id, card, answer.action));
                    card.waiting = false;
                    if (option === 'decline') return void (await this.redraw(id, card, answer.action, { option: 'decline' }));
                    const allowedMore = option === 'approveAndRemember' && answer.grantId ? allowedMoreLine() : undefined;
                    // The tap is recorded; running it takes as long as the tool does, so it does not hold the chat
                    void this.dispatch(id, card, answer.action, option, allowedMore);
                    return;
                }
                case 'close': {
                    const answer = await orbit.cancel(botId, id, { actorKey, revision: tap.revision });
                    card.waiting = false;
                    if (answer.outcome === 'changed') await this.redraw(id, card, answer.action, { closed: true });
                    else if (answer.action) await this.redrawFor(id, card, answer.action);
                    return;
                }
                case 'moreTime': {
                    const wait = (await orbit.cardSettings(botId)).cardWaitMinutes;
                    const answer = await orbit.extend(botId, id, { actorKey, revision: tap.revision, reviewMinutes: wait });
                    if (answer.outcome === 'changed') await this.redraw(id, card, answer.action);
                    else if (answer.outcome === 'no_more_time') await this.deps.cards.say(botId, roomId, 'This card cannot wait any longer. Tap Review again, or ask me again.');
                    else if (answer.action) await this.redrawFor(id, card, answer.action);
                    return;
                }
                case 'reviewAgain':
                    return void (await this.reviewAgain(id, card));
                case 'askAgain': {
                    await orbit.revokeGrants(botId, { requesterKey: actorKey, conversationKey: conversationKeyOf(roomId), reason: 'ask_again' });
                    const action = card.facts.action;
                    // Same card, without "allow more": the next call asks again
                    await this.redraw(id, card, { ...action, revision: action.revision + 1 }, { option: 'approveAndRemember' });
                    return;
                }
            }
        } catch (error) {
            console.warn(`[ToolApprovals] Could not take the tap on ${tap.ask}:`, errorText(error));
            if (error instanceof OrbitActionsUnavailable) {
                await this.deps.cards.say(botId, roomId, "I couldn't record that. Tap again in a moment.").catch(() => undefined);
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
        const verdict = stale ? null : await this.deps.gate.decide(gateCall(botId, action.toolName, entry, person));
        if (!entry || !verdict || verdict.kind !== 'ask') {
            const why = verdict?.kind === 'refuse' ? verdict.line : 'That changed since, so I need you to ask me again.';
            await this.deps.cards.say(botId, roomId, why);
            return;
        }
        const proposed = await this.propose({ botId, roomId, person, toolName: action.toolName, toolTitle: entry.title, entry, args: action.arguments, decision: verdict, cardOnly: true });
        if (proposed.kind === 'failed') await this.deps.cards.say(botId, roomId, "I couldn't show the card. Try again in a moment.");
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
                if (followUp) await this.deps.followUp?.({ botId, roomId, person, title, state: followUp, ...(result ? { result } : {}) }).catch(() => undefined);
            };

            // The checks that count are the ones right before the call: the tool, the person and the settings as they are now
            const entry = await this.deps.tools.find(botId, action.toolName).catch(() => null);
            const verdict = entry && entry.fingerprint === action.toolFingerprint ? await this.deps.gate.decide(gateCall(botId, action.toolName, entry, person)) : null;
            if (!entry || !verdict) return void (await finish('notSent', { result: 'The tool changed since, so nothing was done.' }, 'failed'));
            if (verdict.kind === 'refuse') return void (await finish('notSent', { result: verdict.line }, 'failed'));
            if (verdict.kind === 'ask' && verdict.policyRevision !== action.policyRevision) {
                return void (await finish('notSent', { result: 'The settings changed since, so nothing was done.' }, 'failed'));
            }

            started = true;
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
                await this.deps.followUp?.({ botId, roomId, person, title, state: 'failed', result: "It couldn't be started, so nothing was done." }).catch(() => undefined);
                return;
            }
            // It may have started: never send it again, and tell the person to check
            await this.redraw(id, card, undefined, { ...picked, unknown: true }).catch(() => undefined);
        } finally {
            this.dispatching.delete(id);
            card.waiting = false;
        }
    }

    /* ------------------------------ the person writes again ------------------------------ */

    /**
     * The person sent a message to the bot in this chat: their remembered approvals last another stretch, and a card still
     * waiting for them closes ("You typed something else, so nothing was done"). Another person's message never calls this.
     * Never throws.
     */
    async onPersonMessage(botId: string, roomId: string, person: Asker): Promise<void> {
        const conversationKey = conversationKeyOf(roomId);
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

const conversationKeyOf = (roomId: string) => `dm:${roomId}`;

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
