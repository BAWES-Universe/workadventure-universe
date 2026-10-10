import assert from "node:assert/strict";
import { test } from "vitest";
import { parseNativeSoundscape } from "../../../../src/front/Components/AudioManager/NativeSoundscapeConfig.ts";
const data = { url: "./cascade.mp3", volume: 0.3, x: 123, y: 456, innerRadius: 64, outerRadius: 320 };
test("missing map property returns no descriptor and preserves legacy path", () =>
    assert.equal(parseNativeSoundscape(undefined, "https://maps.example/gate/map.tmj"), undefined));
test("opt-in descriptor resolves only its relative asset and enforces looping", () =>
    assert.deepEqual(parseNativeSoundscape(JSON.stringify(data), "https://maps.example/gate/map.tmj"), {
        ...data,
        url: "https://maps.example/gate/cascade.mp3",
        loop: true,
    }));
test("bad JSON, credentials, unexpected controls and malformed geometry cannot opt in", () => {
    for (const value of [
        "no",
        false,
        "null",
        "[]",
        JSON.stringify({ ...data, url: "https://user:pass@example.com/a" }),
        JSON.stringify({ ...data, muted: false }),
        JSON.stringify({ ...data, outerRadius: 0 }),
        JSON.stringify({ ...data, x: "123" }),
        JSON.stringify({ ...data, url: "data:audio/mp3,abc" }),
    ])
        assert.throws(() => parseNativeSoundscape(value, "https://maps.example/gate/map.tmj"));
});
