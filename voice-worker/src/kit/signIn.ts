// What a key is. Most companies take one key. Some need several named fields (AWS: access key, secret and region; Azure:
// key and region; Google: a service account file). Orbit stores those as one JSON object in the same encrypted key, so the
// worker reads them here and nowhere else. Values stay inside the Secret until a connector needs them.
import { Secret } from '../connectors.ts';
import { failure } from './errors.ts';

/**
 * The named fields of a key. A key that is not a JSON object is one field, `key`. A missing field throws a failure with
 * status 401, which Orbit shows as a refused key, so a half-filled key is never sent anywhere.
 */
export function signInFields<const F extends string>(adapter: string, key: Secret, names: readonly F[]): Record<F, Secret> {
    const raw = key.reveal().trim();
    let parsed: Record<string, unknown> = { key: raw };
    if (raw.startsWith('{')) {
        try {
            const value: unknown = JSON.parse(raw);
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) parsed = value as Record<string, unknown>;
        } catch {
            throw failure(adapter, 'key could not be read', 401);
        }
    }
    const fields = {} as Record<F, Secret>;
    for (const name of names) {
        const value = parsed[name];
        const text = typeof value === 'string' ? value.trim() : value !== undefined && value !== null && typeof value === 'object' ? JSON.stringify(value) : '';
        if (!text) throw failure(adapter, `key is missing ${name}`, 401);
        fields[name] = new Secret(text);
    }
    return fields;
}

/** The primary language of "ar-KW" or "ar_KW", lowercase: what most companies take. */
export const baseLanguage = (lang: string): string => lang.split(/[-_]/)[0].toLowerCase();
