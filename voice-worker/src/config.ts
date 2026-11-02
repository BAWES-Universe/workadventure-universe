// Settings come from the environment. Everything has a default that works on one machine; none of it switches voice on or off.
import type { IceConfig } from './lane.ts';
import { DEFAULT_BARGE_IN_MS } from './recognition.ts';
import { DEFAULT_MAX_REPLY_SECONDS, DEFAULT_MAX_UTTERANCE_SECONDS, DEFAULT_SPEECH_TIMEOUT_SECONDS, type WorkerOptions } from './server.ts';

const int = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function parseIce(env: NodeJS.ProcessEnv): IceConfig {
    const ice: IceConfig = {};
    // VOICE_ICE_SERVERS: JSON list like [{"urls":"turn:turn.example:3478","username":"u","credential":"p"}]
    if (env.VOICE_ICE_SERVERS) ice.iceServers = JSON.parse(env.VOICE_ICE_SERVERS);
    // VOICE_ICE_PORT_RANGE: "40000-40100", the UDP ports to open on the host
    const range = /^(\d+)-(\d+)$/.exec(env.VOICE_ICE_PORT_RANGE ?? '');
    if (range) ice.icePortRange = [Number(range[1]), Number(range[2])];
    // VOICE_PUBLIC_IP: the address people can reach this machine on, when it is behind a NAT
    if (env.VOICE_PUBLIC_IP) ice.iceAdditionalHostAddresses = env.VOICE_PUBLIC_IP.split(',').map((a) => a.trim());
    return ice;
}

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): WorkerOptions {
    return {
        port: int(env.VOICE_WORKER_PORT, 8830),
        host: env.VOICE_WORKER_HOST || '127.0.0.1',
        secret: env.VOICE_WORKER_SECRET || undefined,
        maxLanes: int(env.VOICE_MAX_LANES, 200),
        maxSessionsPerConnection: int(env.VOICE_MAX_SESSIONS_PER_BOT, 64),
        ice: parseIce(env),
        maxUtteranceSeconds: int(env.VOICE_MAX_UTTERANCE_SECONDS, DEFAULT_MAX_UTTERANCE_SECONDS),
        maxReplySeconds: int(env.VOICE_MAX_REPLY_SECONDS, DEFAULT_MAX_REPLY_SECONDS),
        speechTimeoutSeconds: int(env.VOICE_SPEECH_TIMEOUT_SECONDS, DEFAULT_SPEECH_TIMEOUT_SECONDS),
        bargeInMs: int(env.VOICE_BARGE_IN_MS, DEFAULT_BARGE_IN_MS),
    };
}
