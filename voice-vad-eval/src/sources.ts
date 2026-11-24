// Where a clip's source recording is, and a short hash of its bytes. The evaluator stores the hash with every clip it scores;
// the report checks the files again and refuses a source that changed since, so an evidence line never carries the hash of
// audio that was not the audio scored.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SYNTHETIC = 'synthetic';

export function sourcePath(data: string, source: string): string | undefined {
    if (source.startsWith('synthetic/')) return undefined;
    if (source.startsWith('en/')) return join(data, 'mini_speech_commands', source.slice(3));
    if (source.startsWith('ar/')) return join(data, 'asc/dataset', source.slice(3));
    if (source.startsWith('sent/')) return join(data, 'ms-snsd/clean_test', source.slice(5));
    return join(data, source);
}

export const shaOf = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

/** The hash of a source recording as it is now ('synthetic' for a clip with no recording behind it). */
export function sourceSha(data: string, source: string): string {
    const path = sourcePath(data, source);
    return path ? shaOf(path) : SYNTHETIC;
}
