// For test/speechObserverCheck.test.ts only: runs speech-observer/check.mts with the real loader swapped for
// fakeDetectorRuntime.mts, to see the command itself pass and fail without the native runtime.
import { register } from 'node:module';

register(
    'data:text/javascript,' +
        encodeURIComponent(`
export async function resolve(specifier, context, next) {
    if (specifier.endsWith('/speechObserverRuntime.ts')) return next(${JSON.stringify(new URL('./fakeDetectorRuntime.mts', import.meta.url).href)}, context);
    return next(specifier, context);
}`)
);
