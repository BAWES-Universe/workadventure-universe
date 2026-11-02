/**
 * Voice inside the Universe AI allowance (#1669). A spoken reply comes out of the same 5-hour window as a text reply, with some
 * replies kept for text and few for a guest; Orbit holds the numbers (its voice limits) and does the counting. This asks it, just
 * before a reply that Universe AI pays for is said, and turns "no" into one line and a paused button (see VoiceCalls).
 *
 * Nothing here can make a reply cost twice: Orbit counts a reply once under its turn id. Anything but a clear "yes" or "no" (Orbit
 * can't be asked, an Orbit from before) leaves the reply in text, so nothing is spoken on Universe AI's account unasked.
 */
import type { SpeechTurn } from './BotSpeech';

/** What the bot server asks of Orbit. `AdminApiService` is the real one; tests give a fake. */
export interface AllowanceOrbit {
    /** Null when Orbit can't be asked or doesn't know the question. */
    checkVoiceAllowance(botId: string, input: { userId: string; isGuest: boolean; turnId: string }): Promise<{ allowed: true } | { allowed: false; resetsAt: string } | null>;
}

/** The person a reply is for, as Orbit counts people: their id as the game gave it, and whether they are a guest. */
export interface Talker {
    userId: string;
    isGuest: boolean;
}

export type SpeakVerdict = 'yes' | 'no' | 'unknown';

/** What the relay needs to settle a turn that Universe AI would pay for. */
export interface TurnGate {
    /** The person's id (their uuid) when the bot knows who the turn is for. */
    personOf(turn: SpeechTurn): string | undefined;
    /** May this reply be spoken? `unknown`: it could not be settled, so it stays in text and nobody is told voice is paused. */
    mayUniverseAiSpeak(turn: SpeechTurn): Promise<SpeakVerdict>;
}

export class OrbitTurnGate implements TurnGate {
    constructor(
        private readonly botId: string,
        private readonly orbit: AllowanceOrbit,
        /** Who a player id is, as the behavior learnt it. Null while it isn't known (nobody to count). */
        private readonly talker: (playerId: number) => Talker | null,
        private readonly log: (message: string) => void = () => undefined
    ) {}

    personOf(turn: SpeechTurn): string | undefined {
        return this.who(turn)?.userId;
    }

    async mayUniverseAiSpeak(turn: SpeechTurn): Promise<SpeakVerdict> {
        const who = this.who(turn);
        // Nobody Orbit could count: it never stops anyone it can't name either
        if (!who) return 'yes';
        const answer = await this.orbit.checkVoiceAllowance(this.botId, { userId: who.userId, isGuest: who.isGuest, turnId: turn.turnId });
        if (!answer) {
            this.log('voice: could not settle the allowance, this reply stays in text');
            return 'unknown';
        }
        return answer.allowed ? 'yes' : 'no';
    }

    private who(turn: SpeechTurn): Talker | null {
        return turn.playerId === undefined ? null : this.talker(turn.playerId);
    }
}

/** The one line a person sees when voice is paused for them. Not a setting: it is the same for every bot. */
export function pausedLine(botName: string): string {
    return `Voice is paused for now. Keep typing: ${botName} still answers here.`;
}
