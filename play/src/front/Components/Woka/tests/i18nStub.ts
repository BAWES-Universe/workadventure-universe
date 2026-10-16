import { tick } from "svelte";
import { readable } from "svelte/store";

/**
 * A stand-in for the translations: every message is its own path ("woka.selectWoka.saveFailed"), with its
 * parameters after it as JSON, so a test can tell which message was shown without copying the English text.
 */
function messages(path: string): unknown {
    const call = (params?: unknown) => (params === undefined ? path : `${path} ${JSON.stringify(params)}`);
    return new Proxy(call, {
        get: (_target, key) => (typeof key === "string" ? messages(path ? `${path}.${key}` : key) : undefined),
    });
}

export const i18nStub = { default: readable(messages("")), LL: readable(messages("")) };

/** What the picker and the popup need from the browser, which jsdom does not have. */
export function stubBrowser(): void {
    class ResizeObserverStub {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
    Element.prototype.scrollIntoView = () => undefined;
    Element.prototype.scrollBy = () => undefined;
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}

/** Lets Svelte's updates and the promises the screens wait on run. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}
