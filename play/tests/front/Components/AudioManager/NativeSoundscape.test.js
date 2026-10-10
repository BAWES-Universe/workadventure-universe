import assert from "node:assert/strict";
import { test } from "vitest";
import { NativeSoundscape, distanceGain } from "../../../../src/front/Components/AudioManager/NativeSoundscape.ts";
const settle = async () => {
    // eslint-disable-next-line no-await-in-loop -- Explicitly drain successive playback microtasks.
    for (let i = 0; i < 5; i++) await Promise.resolve();
};
const controls = { volume: 1, muted: false, paused: false, stopped: false, talking: false, decreaseWhileTalking: true };
const music = { url: "https://assets.example/music.mp3", volume: 0.8, loop: true };
const emitter = {
    url: "https://assets.example/water.mp3",
    volume: 0.6,
    loop: true,
    x: 0,
    y: 0,
    innerRadius: 10,
    outerRadius: 110,
};
function harness(options = {}) {
    const media = [],
        states = [],
        aggregate = [],
        nodes = [],
        contexts = [];
    const container = {
        children: [],
        append(item) {
            assert(media.includes(item), "Only real media may enter DOM");
            this.children.push(item);
            item.parent = this;
        },
    };
    class Media {
        constructor() {
            this._volume = 1;
            this.paused = true;
            this.muted = false;
            this.currentTime = 0;
            this.playCalls = 0;
            this.loadCalls = 0;
            this.src = "";
            this.classList = { add() {} };
        }
        get volume() {
            return 1;
        }
        set volume(value) {} // Simulate ignored native element volume.
        load() {
            this.loadCalls++;
            if (this.src) assert.equal(this.crossOrigin, "anonymous");
        }
        pause() {
            this.paused = true;
        }
        removeAttribute(name) {
            if (name === "src") this.src = "";
            this.classList = { add() {} };
        }
        remove() {
            this.removed = true;
            if (this.parent) {
                this.parent.children = this.parent.children.filter((m) => m !== this);
                this.parent = undefined;
            }
        }
        play() {
            this.playCalls++;
            if (options.blockMedia) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
            this.paused = false;
            return Promise.resolve();
        }
    }
    const context = {
        state: options.running ? "running" : "suspended",
        currentTime: 0,
        destination: {},
        resumeCalls: 0,
        closeCalls: 0,
        createMediaElementSource(m) {
            assert.equal(m.crossOrigin, "anonymous");
            const node = {
                media: m,
                disconnect() {
                    this.disconnected = true;
                },
                connect() {
                    this.disconnected = false;
                },
            };
            nodes.push(node);
            return node;
        },
        createGain() {
            const gain = {
                gain: {
                    value: 0,
                    cancelScheduledValues() {},
                    setValueAtTime(v) {
                        this.value = v;
                    },
                    setTargetAtTime(v) {
                        this.value = v;
                    },
                },
                disconnect() {
                    this.disconnected = true;
                },
                connect() {
                    this.disconnected = false;
                },
            };
            nodes.push(gain);
            return gain;
        },
        resume() {
            this.resumeCalls++;
            if (options.blockContext) return Promise.reject(new Error("blocked"));
            this.state = "running";
            return Promise.resolve();
        },
        close() {
            this.closeCalls++;
            this.state = "closed";
            return Promise.resolve();
        },
    };
    const player = new NativeSoundscape({
        audioContainer: container,
        onPlayerState: (state) => aggregate.push(state),
        onEnded: options.onEnded,
        createContext: () => {
            contexts.push(context);
            return context;
        },
        createAudio: () => {
            const m = new Media();
            media.push(m);
            return m;
        },
        onState: (channel, state) => states.push({ channel, state }),
        fadeDuration: options.fadeDuration ?? 0,
    });
    player.setControls({ ...controls, ...options.controls });
    const start = () => {
        player.setListenerPosition(0, 0);
        player.setMusic(music);
        player.setEmitter(emitter);
    };
    return {
        player,
        media,
        states,
        aggregate,
        container,
        nodes,
        contexts,
        context,
        start,
        gains: () => nodes.filter((n) => n.gain).map((n) => n.gain.value),
    };
}
test("distance smoothstep is player-space, bounded, and camera-independent", () => {
    assert.equal(distanceGain(emitter, 0, 0), 1);
    assert.equal(distanceGain(emitter, 60, 0), 0.5);
    assert.equal(distanceGain(emitter, 110, 0), 0);
    assert.equal(distanceGain(emitter, 999, 999), 0);
});
test("movement only changes water gain; music and water loop are never restarted", async () => {
    const h = harness();
    h.start();
    await settle();
    h.media[0].currentTime = 123;
    h.media[1].currentTime = 32;
    const calls = h.media.map((m) => m.playCalls),
        loads = h.media.map((m) => m.loadCalls);
    for (let i = 0; i < 20; i++) {
        h.player.setListenerPosition(60, 0);
        assert.equal(h.gains()[1], 0.3);
        h.player.setListenerPosition(200, 0);
        assert.equal(h.gains()[1], 0);
        h.player.setListenerPosition(0, 0);
    }
    assert.deepEqual(h.gains(), [0.8, 0.6]);
    assert.deepEqual(
        h.media.map((m) => m.playCalls),
        calls
    );
    assert.deepEqual(
        h.media.map((m) => m.loadCalls),
        loads
    );
    assert.deepEqual(
        h.media.map((m) => m.currentTime),
        [123, 32]
    );
    h.player.destroy();
});
test("master and mute work even when HTML element volume is ignored", async () => {
    const h = harness();
    h.start();
    await settle();
    h.player.setControls({ ...controls, volume: 0.25 });
    assert.deepEqual(h.gains(), [0.2, 0.15]);
    h.player.setControls({ ...controls, volume: 0 });
    assert.deepEqual(h.gains(), [0, 0]);
    h.player.setControls({ ...controls, muted: true });
    assert.deepEqual(h.gains(), [0, 0]);
    assert(h.media.every((m) => m.muted));
    h.player.setControls({ ...controls, talking: true });
    assert.deepEqual(h.gains(), [0.4, 0.3]);
    h.player.destroy();
});
test("saved muted paused state precedes initial loads; pause preserves positions", async () => {
    const h = harness({ controls: { muted: true, paused: true } });
    h.start();
    assert(h.media.every((m) => m.playCalls === 0));
    assert.deepEqual(h.gains(), [0, 0]);
    h.player.setControls(controls);
    await settle();
    h.media[0].currentTime = 42;
    h.player.setControls({ ...controls, paused: true });
    assert(h.media.every((m) => m.paused));
    h.player.setListenerPosition(50, 0);
    assert(h.media.every((m) => m.paused));
    h.player.setControls(controls);
    await settle();
    assert.equal(h.media[0].currentTime, 42);
    h.player.destroy();
});
test("Stop survives movement and source updates until existing store explicitly clears it", async () => {
    const h = harness();
    h.start();
    await settle();
    h.player.setControls({ ...controls, stopped: true });
    const calls = h.media.map((m) => m.playCalls);
    h.player.setListenerPosition(80, 0);
    h.player.setMusic({ ...music, volume: 0.5 });
    assert.deepEqual(
        h.media.map((m) => m.playCalls),
        calls
    );
    assert(h.media.every((m) => m.paused));
    h.player.setControls(controls);
    await settle();
    assert(h.media.every((m) => !m.paused));
    h.player.destroy();
});
test("water replacement during a music transition never creates a fourth media node", async () => {
    const h = harness({ fadeDuration: 10000 });
    h.start();
    await settle();
    h.player.setMusic({ ...music, url: "https://assets.example/music2.mp3" });
    await settle();
    assert.equal(h.media.length, 3);
    for (let i = 0; i < 20; i++) {
        h.player.setEmitter({ ...emitter, url: `https://assets.example/water${i}.mp3` });
        // eslint-disable-next-line no-await-in-loop -- Verify each retired/reused graph before the next transition.
        await settle();
        assert.equal(h.media.length, 3);
    }
    assert.equal(h.contexts.length, 1);
    h.player.destroy();
});
test("same music source gain update preserves playback and music replacement uses original fade", async () => {
    const h = harness({ fadeDuration: 10000 });
    h.start();
    await settle();
    h.media[0].currentTime = 15;
    h.player.setMusic({ ...music, volume: 0.2 });
    assert.equal(h.media[0].currentTime, 15);
    assert.equal(h.media[0].playCalls, 1);
    h.player.setMusic({ ...music, url: "https://assets.example/second.mp3" });
    await settle();
    assert.equal(h.media.length, 3);
    assert.equal(h.media[0].paused, false);
    h.player.destroy();
});
test("resource/CORS error does not create fallback or interrupt working music", async () => {
    const h = harness();
    h.start();
    await settle();
    const water = h.media[1];
    water.pause();
    water.error = { code: 4, message: "resource or CORS failure" };
    water.onerror();
    assert(h.states.some((s) => s.channel === "water" && s.state === "error"));
    assert.equal(h.media[0].paused, false);
    assert.equal(h.media.length, 2);
    h.player.destroy();
});
test("gesture retry starts context resume and both blocked media synchronously", async () => {
    const options = { blockMedia: true };
    const h = harness(options);
    h.start();
    await settle();
    options.blockMedia = false;
    h.player.retry();
    assert.equal(h.context.resumeCalls, 1);
    assert(h.media.every((m) => m.playCalls === 2));
    await settle();
    assert(h.states.some((s) => s.channel === "context" && s.state === "playing"));
    h.player.destroy();
});
test("denied context stays explicitly blocked and has no alternate playback layer", async () => {
    const h = harness({ blockContext: true });
    h.start();
    await settle();
    h.player.retry();
    await settle();
    assert.equal(h.states.at(-1).state, "not_allowed");
    assert.equal(h.contexts.length, 1);
    h.player.destroy();
});
test("destroy silences all nodes, detaches resources and closes ONLY owned context", async () => {
    const h = harness();
    h.start();
    await settle();
    h.player.destroy();
    h.player.destroy();
    assert(h.media.every((m) => m.paused && !m.src && m.removed));
    assert(h.nodes.every((n) => n.disconnected));
    assert.equal(h.context.closeCalls, 1);
    const count = h.media.length;
    h.player.setMusic(music);
    h.player.retry();
    assert.equal(h.media.length, count);
    assert.equal(h.context.resumeCalls, 0);
});
test("invalid URLs, radii, coordinates and nonfinite gain rejected before allocation", () => {
    const h = harness();
    assert.doesNotThrow(() => h.player.setMusic({ ...music, url: "javascript:alert(1)" }));
    assert.doesNotThrow(() => h.player.setEmitter({ ...emitter, outerRadius: 10 }));
    assert.doesNotThrow(() => h.player.setMusic({ ...music, volume: NaN }));
    assert.doesNotThrow(() => h.player.setListenerPosition(Infinity, 0));
    assert.equal(h.media.length, 0);
    assert(h.states.some(({ channel, state }) => channel === "music" && state === "error"));
    assert(h.states.some(({ channel, state }) => channel === "water" && state === "error"));
    h.player.destroy();
});
test("invalid emitter reports error without interrupting music and clears on removal or repair", async () => {
    const h = harness();
    h.start();
    h.player.retry();
    await settle();
    const musicMedia = h.media[0];
    musicMedia.currentTime = 37;
    h.player.setEmitter({ ...emitter, outerRadius: 0 });
    assert.equal(h.aggregate.at(-1), "error");
    assert.equal(h.container.children.length, 1);
    assert.equal(musicMedia.currentTime, 37);
    assert.equal(musicMedia.paused, false);
    h.player.setListenerPosition(20, 30);
    assert.equal(h.aggregate.at(-1), "error");
    h.player.clearListenerPosition();
    assert.equal(h.aggregate.at(-1), "error");
    h.player.setControls({ ...controls, muted: true });
    assert.equal(h.aggregate.at(-1), "error");
    h.player.setControls(controls);
    h.player.setEmitter(undefined);
    assert.equal(h.aggregate.at(-1), "playing");
    h.player.setEmitter(emitter);
    await settle();
    assert.equal(h.aggregate.at(-1), "playing");
    h.player.setListenerPosition(Infinity, 0);
    assert.equal(h.gains()[1], 0);
    h.player.destroy();
});
test("destroy during pending media play cannot resurrect or allocate audio", async () => {
    const h = harness();
    let complete;
    h.start();
    await settle();
    h.player.setControls({ ...controls, paused: true });
    h.media[0].play = () =>
        new Promise((resolve) => {
            complete = resolve;
        });
    h.player.setControls(controls);
    h.player.destroy();
    complete();
    await settle();
    assert(h.media.every((m) => m.paused && !m.src));
    assert.equal(h.context.closeCalls, 1);
});
test("water starts silent until a finite listener location is available", async () => {
    const h = harness();
    h.player.setEmitter(emitter);
    await settle();
    assert.equal(h.gains()[0], 0);
    h.player.setListenerPosition(0, 0);
    assert.equal(h.gains()[0], 0.6);
    h.player.destroy();
});

test("active real media are component-owned; retired slots detach and destroyed container empties", async () => {
    const h = harness({ fadeDuration: 10000 });
    h.start();
    await settle();
    assert.equal(h.container.children.length, 2);
    h.player.setMusic({ ...music, url: "https://assets.example/other.mp3" });
    await settle();
    assert.equal(h.container.children.length, 3);
    h.player.setEmitter(undefined);
    assert.equal(h.container.children.length, 2);
    h.player.destroy();
    assert.equal(h.container.children.length, 0);
});
test("aggregate state reports blocked context despite media play resolution; gesture restores playing", async () => {
    const h = harness();
    h.start();
    await settle();
    assert.equal(h.aggregate.at(-1), "not_allowed");
    h.player.retry();
    await settle();
    assert.equal(h.aggregate.at(-1), "playing");
    h.media[1].pause();
    h.media[1].onerror();
    assert.equal(h.aggregate.at(-1), "error");
    h.player.destroy();
    assert.equal(h.aggregate.at(-1), undefined);
});
test("music completion leaves looping water represented as playing", async () => {
    const h = harness({ running: true });
    h.start();
    await settle();
    h.media[0].onended();
    assert.equal(h.aggregate.at(-1), "playing");
    h.player.destroy();
});
test("a non-looping track that ends hides the controls only once no ambience is left", async () => {
    let ended = 0;
    const h = harness({ running: true, onEnded: () => ended++ });
    h.player.setListenerPosition(0, 0);
    h.player.setMusic({ ...music, loop: false });
    h.player.setEmitter(emitter);
    await settle();
    h.media[0].onended();
    // The ambience still loops, so its controls stay.
    assert.equal(ended, 0);
    assert.equal(h.aggregate.at(-1), "playing");
    h.player.setMusic({ ...music, loop: false });
    h.player.setEmitter(undefined);
    assert.equal(ended, 1);
    assert.equal(h.aggregate.at(-1), undefined);
    // A same-track update afterwards neither restarts it nor ends it twice.
    h.player.setMusic({ ...music, loop: false });
    await settle();
    assert.equal(ended, 1);
    assert.equal(h.media[0].playCalls, 1);
    assert.equal(h.aggregate.at(-1), undefined);
    // A new track starts normally.
    h.player.setMusic({ ...music, url: "https://assets.example/second.mp3" });
    await settle();
    assert.equal(h.aggregate.at(-1), "playing");
    h.player.destroy();
});
test("a non-looping track without ambience hides the controls when it ends", async () => {
    let ended = 0;
    const h = harness({ running: true, onEnded: () => ended++ });
    h.player.setListenerPosition(0, 0);
    h.player.setMusic({ ...music, loop: false });
    await settle();
    h.media[0].onended();
    assert.equal(ended, 1);
    assert.equal(h.aggregate.at(-1), undefined);
    h.player.destroy();
});
test("interrupted music fade returning to the outgoing track preserves its timestamp and max three nodes", async () => {
    const h = harness({ fadeDuration: 10000, running: true });
    h.start();
    await settle();
    h.media[0].currentTime = 17;
    h.player.setMusic({ ...music, url: "https://assets.example/second.mp3" });
    await settle();
    h.player.setMusic(music);
    await settle();
    assert.equal(h.media[0].currentTime, 17);
    assert.equal(h.media[0].playCalls, 1);
    assert.equal(h.media.length, 3);
    h.player.destroy();
});
test("pending context resume after unload cannot resurrect aggregate state", async () => {
    const h = harness();
    h.start();
    await settle();
    let resolve;
    h.context.resume = () =>
        new Promise((r) => {
            resolve = r;
        });
    h.player.retry();
    h.player.destroy();
    resolve();
    await settle();
    assert.equal(h.aggregate.at(-1), undefined);
    assert(h.media.every((m) => m.paused && !m.src));
});
test("unmount/remount creates no duplicate voices or surviving component elements", async () => {
    const first = harness({ running: true });
    first.start();
    await settle();
    first.player.destroy();
    const second = harness({ running: true });
    second.start();
    await settle();
    assert.equal(first.container.children.length, 0);
    assert.equal(first.context.closeCalls, 1);
    assert.equal(second.container.children.length, 2);
    assert(first.media.every((m) => m.paused && !m.src));
    second.player.destroy();
    assert.equal(second.container.children.length, 0);
});
test("map source unload immediately retires both attached channels", async () => {
    const h = harness({ running: true });
    h.start();
    await settle();
    h.player.setMusic(undefined);
    h.player.setEmitter(undefined);
    assert.equal(h.container.children.length, 0);
    assert(h.media.every((m) => m.paused && !m.src));
    assert.equal(h.aggregate.at(-1), undefined);
    h.player.destroy();
});

test("100 source swaps retain at most three reusable graphs and disconnect retired DOM slots", async () => {
    const h = harness({ running: true });
    h.start();
    await settle();
    for (let i = 0; i < 100; i++) {
        h.player.setMusic({ ...music, url: `https://assets.example/music${i}.mp3` });
        h.player.setEmitter({ ...emitter, url: `https://assets.example/water${i}.mp3` });
        // eslint-disable-next-line no-await-in-loop -- Verify each retired/reused graph before the next transition.
        await settle();
        assert(h.media.length <= 3);
        assert(h.nodes.length <= 6);
        assert.equal(h.container.children.length, 2);
        assert.equal(h.nodes.filter((n) => n.disconnected === false).length, 4);
    }
    h.player.setEmitter(undefined);
    assert.equal(h.nodes.filter((n) => n.disconnected === false).length, 2);
    h.player.destroy();
    assert(h.nodes.every((n) => n.disconnected));
    assert.equal(h.container.children.length, 0);
});
test("undefined listener on map transition silences water without disturbing music", async () => {
    const h = harness({ running: true });
    h.start();
    await settle();
    h.player.clearListenerPosition();
    assert.equal(h.gains()[1], 0);
    assert.equal(h.gains()[0], 0.8);
    assert.equal(h.media[0].paused, false);
    h.player.destroy();
});
