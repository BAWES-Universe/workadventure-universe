// Checks bridge messages against schema.json. Anything that does not match is dropped by the receiver.
import Ajv from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import schema from '../schema.json' with { type: 'json' };

const FROM_BOT = ['session.open', 'lane.open', 'lane.signal', 'lane.close', 'mode.set', 'bot.say', 'bot.retract', 'voice.stop', 'session.end', 'room.join', 'room.leave', 'room.people'] as const;
const FROM_WORKER = ['session.start', 'participant.join', 'participant.leave', 'lane.signal', 'playback.progress', 'engine.status', 'room.state', 'error'] as const;

const ajv = new Ajv({ strict: false, allErrors: false });
ajv.addSchema(schema);

const compile = (types: readonly string[]): Map<string, ValidateFunction> =>
    new Map(types.map((t) => [t, ajv.compile({ $ref: `${schema.$id}#/$defs/${t}` })]));

const fromBot = compile(FROM_BOT);
const fromWorker = compile(FROM_WORKER);

export type Direction = 'fromBot' | 'fromWorker';

/** Returns null when the message is valid for that direction, else a short reason. */
export function checkMessage(direction: Direction, msg: unknown): string | null {
    if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') return 'not a message';
    const type = (msg as { type: string }).type;
    const validate = (direction === 'fromBot' ? fromBot : fromWorker).get(type);
    if (!validate) return `unknown type ${type.slice(0, 40)}`;
    if (validate(msg)) return null;
    const e = validate.errors?.[0];
    return `${type}: ${e?.instancePath || '/'} ${e?.message ?? 'invalid'}`.slice(0, 200);
}
