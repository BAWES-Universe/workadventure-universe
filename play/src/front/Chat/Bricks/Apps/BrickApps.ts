import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import { namesLine, type AppBrick, type MyApp } from "./Apps";

/** One of the person's apps and this Brick's way of using it. */
export interface BrickAppUse {
    app: MyApp;
    brick: AppBrick;
}

/**
 * The apps one Brick can use, out of the person's own apps (what Orbit lists on the Apps page), in the order Orbit gave them.
 * Undefined until the apps were read once, so a row can say "Loading" instead of "No apps yet".
 */
export function appsOfBrick(apps: MyApp[] | undefined, botId: string): BrickAppUse[] | undefined {
    if (!apps) return undefined;
    const uses: BrickAppUse[] = [];
    for (const app of apps) {
        const brick = app.bricks.find((one) => one.botId === botId);
        if (brick) uses.push({ app, brick });
    }
    return uses;
}

/**
 * The line under "Apps" on a Brick's page: "Gmail and Google Calendar", "Gmail, Google Calendar and 2 more", "No apps yet". An app
 * whose sign-in ended leads the line, since that is the one thing the person has to do something about. An app the Brick has
 * turned off is said as off ("Gmail · off", "Gmail · Notion off") and never left out, so the row never says "No apps yet" while
 * the Brick has apps.
 */
export function appsBrief(uses: BrickAppUse[] | undefined, LL: TranslationFunctions, showAppUse?: boolean): string {
    const text = LL.chat.brick.apps;
    if (!uses) return "";
    const apps = appsLine(uses, LL);
    // Which state "Show app use" is in leads the line (a long list of apps may be cut at its end), when the caller knows it
    if (showAppUse === undefined) return apps;
    return text.onBrick.withUse({ use: showAppUse ? text.onBrick.useShown() : text.onBrick.useHidden(), apps });
}

function appsLine(uses: BrickAppUse[], LL: TranslationFunctions): string {
    const text = LL.chat.brick.apps;
    const lost = uses.filter((use) => use.app.reconnectRequired);
    if (lost.length === 1) return text.onBrick.needsSignIn({ app: lost[0].app.name });
    if (lost.length > 1) return text.onBrick.needSignInMany({ count: lost.length });
    const say = (list: BrickAppUse[]) =>
        namesLine(
            list.map((use) => use.app.name),
            text.and(),
            (count) => text.more({ count })
        );
    const on = uses.filter((use) => use.brick.enabled);
    const off = uses.filter((use) => !use.brick.enabled);
    if (on.length === 0 && off.length === 0) return text.onBrick.none();
    if (off.length === 0) return say(on);
    if (on.length === 0) return text.onBrick.allOff({ names: say(off) });
    return text.onBrick.someOff({ on: say(on), off: say(off) });
}
