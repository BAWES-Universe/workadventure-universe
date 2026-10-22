/**
 * Hide bot conversations (#1166): a console warning from the bot server goes to Sentry Logs and rides as a breadcrumb
 * on the next Sentry event, so it must not name the player a bot was talking to (#1211). The warnings print the
 * numeric id only. Debug-only lines (`NODE_ENV=development` or `ENABLE_BOT_DEBUG`) are not sent in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const files = [
    ...readdirSync(join(root, "behaviors")).filter((name) => name.endsWith(".ts")).map((name) => join(root, "behaviors", name)),
    join(root, "client", "BotClient.ts"),
];

/** A console.warn or console.error call that interpolates a player's display name. */
const NAMES_A_PLAYER = /console\.(warn|error)\([^;]*(\$\{(userName|senderName)\}|p\.name)/;

describe("console warnings do not name the player", () => {
    it.each(files)("%s", (file) => {
        expect(readFileSync(file, "utf8")).not.toMatch(NAMES_A_PLAYER);
    });
});
