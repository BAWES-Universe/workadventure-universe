import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import { AppEmoji, REPORT_EMOJI } from "./emoji";

const DIR = path.join(__dirname, "..", "..", "assets", "emoji");

/** A stand-in for Discord: the app's id, its emoji, and what the bot adds. */
function fakeDiscord(existing: Array<{ id: string; name: string }>, fail?: "list" | "post") {
    const posted: Array<{ url: string; body: { name: string; image: string } }> = [];
    const http = {
        get: async (url: string) => {
            if (url.endsWith("/applications/@me")) return { data: { id: "app-1" } };
            if (fail === "list") throw new Error("403 Missing Access");
            return { data: { items: existing } };
        },
        post: async (url: string, body: { name: string; image: string }) => {
            if (fail === "post") throw new Error("400 Invalid Form Body");
            posted.push({ url, body });
            return { data: { id: `new-${body.name}` } };
        },
    };
    return { http: http as never, posted };
}

test("the five icons ship with the bot as 64px PNGs", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const name of Object.values(REPORT_EMOJI)) {
        const png = await readFile(path.join(DIR, `${name}.png`));
        assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), 64);
        assert.equal(png.readUInt32BE(20), 64);
    }
});

test("adds only the missing emoji, and uses the ones the app already has", async () => {
    const { http, posted } = fakeDiscord([
        { id: "e-planet", name: "universe_planet" },
        { id: "e-world", name: "universe_world" },
        { id: "e-other", name: "something_else" },
    ]);
    const icons = await new AppEmoji("token", http, DIR).get();

    assert.deepEqual(
        posted.map((entry) => entry.body.name),
        ["universe_room", "universe_people", "universe_clock"]
    );
    assert.ok(posted.every((entry) => entry.url === "https://discord.com/api/v10/applications/app-1/emojis"));
    assert.ok(posted.every((entry) => entry.body.image.startsWith("data:image/png;base64,")));
    assert.deepEqual(icons, {
        universe: { id: "e-planet", name: "universe_planet" },
        world: { id: "e-world", name: "universe_world" },
        room: { id: "new-universe_room", name: "universe_room" },
        people: { id: "new-universe_people", name: "universe_people" },
        clock: { id: "new-universe_clock", name: "universe_clock" },
    });
});

test("sets them up once", async () => {
    const { http, posted } = fakeDiscord([]);
    const emoji = new AppEmoji("token", http, DIR);
    await emoji.get();
    await emoji.get();
    assert.equal(posted.length, 5);
});

test("falls back to no icons when Discord says no, and tries again next time", async () => {
    const quiet = console.warn;
    console.warn = () => undefined;
    try {
        assert.deepEqual(await new AppEmoji("token", fakeDiscord([], "list").http, DIR).get(), {});
        assert.deepEqual(await new AppEmoji("token", fakeDiscord([], "post").http, DIR).get(), {});
    } finally {
        console.warn = quiet;
    }
});
