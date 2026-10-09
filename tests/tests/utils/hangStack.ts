import * as fs from "fs";
import type { CDPSession, Page } from "playwright/test";
import { test } from "playwright/test";

/**
 * Says what a page was doing when a test ends with it frozen (a click that never returns, an element that never
 * settles, a menu that never opens). Chromium gives the JavaScript stack of the main thread through the devtools
 * protocol; Firefox and WebKit only get the "frozen" verdict. The verdict and the stack go to the test's output
 * folder as hang-stack.txt (next to its trace) and to the console. A heartbeat in the page's console, once a second,
 * shows in the trace when the page last ran.
 */

type Disposable = { [Symbol.asyncDispose]: () => Promise<void> };

const HEARTBEAT = "[heartbeat]";

export function heartbeatScript(): string {
    return `setInterval(() => console.debug(${JSON.stringify(HEARTBEAT)}), 1000);`;
}

/** Watches the page from now until the test lets go of it ("await using"), and reports if it is frozen then. */
export async function watchForHang(page: Page): Promise<void> {
    const cdp = await openDebugger(page);
    const disposable = page as unknown as Disposable;
    const dispose = disposable[Symbol.asyncDispose];
    disposable[Symbol.asyncDispose] = async () => {
        await reportIfFrozen(page, cdp);
        await dispose.call(page);
    };
}

/** Chromium only: a debugger that is already enabled can pause a busy thread later (the pause interrupts running code). */
async function openDebugger(page: Page): Promise<CDPSession | undefined> {
    if (page.context().browser()?.browserType().name() !== "chromium") return undefined;
    try {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Debugger.enable");
        return cdp;
    } catch {
        return undefined;
    }
}

async function reportIfFrozen(page: Page, cdp: CDPSession | undefined): Promise<void> {
    if (page.isClosed()) return;
    const alive = await Promise.race([
        // An error (a page that is navigating, say) still means the page answered.
        page.evaluate(() => true).then(
            () => true,
            () => true
        ),
        new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), 3000);
        }),
    ]);
    if (alive) return;

    const lines = [`The page was frozen when the test ended: ${page.url()}`];
    if (cdp) {
        const paused = new Promise<string[]>((resolve) => {
            cdp.once("Debugger.paused", (event) =>
                resolve(
                    event.callFrames.map(
                        (frame) =>
                            `${frame.functionName || "(anonymous)"} ${frame.url}:${frame.location.lineNumber + 1}:${
                                (frame.location.columnNumber ?? 0) + 1
                            }`
                    )
                )
            );
        });
        cdp.send("Debugger.pause").catch(() => undefined);
        const frames = await Promise.race([
            paused,
            new Promise<string[]>((resolve) => {
                setTimeout(() => resolve(["(no stack: the page did not pause within 5 seconds)"]), 5000);
            }),
        ]);
        lines.push("Main thread stack, innermost first:", ...frames.map((frame) => `  ${frame}`));
        cdp.send("Debugger.resume").catch(() => undefined);
    } else {
        lines.push("(no stack: only Chromium can report one)");
    }
    const text = lines.join("\n");
    console.log(text);
    try {
        fs.writeFileSync(test.info().outputPath("hang-stack.txt"), text + "\n");
    } catch {
        // Outside a test (no output folder): the console has it.
    }
}
