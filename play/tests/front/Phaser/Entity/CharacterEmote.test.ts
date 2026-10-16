import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Character as CharacterType } from "../../../../src/front/Phaser/Entity/Character";
import {
    DEPTH_EMOTE_INDEX,
    DEPTH_INGAME_TEXT_INDEX,
    DEPTH_UI_INDEX,
} from "../../../../src/front/Phaser/Game/DepthIndexes";

class DOMElement {
    constructor(_scene: unknown, _x: number, _y: number, public node: HTMLElement) {}
    depth = 0;
    setAlpha() {}
    setDepth(depth: number) {
        this.depth = depth;
        return this;
    }
}

let Character: typeof CharacterType;

beforeAll(async () => {
    const phaser = await import("phaser");
    vi.stubGlobal("Phaser", { ...phaser, GameObjects: { ...phaser.GameObjects, DOMElement } });
    ({ Character } = await import("../../../../src/front/Phaser/Entity/Character"));
});

describe("Character emote rendering", () => {
    it("keeps emotes above an existing Say/Think stack", () => {
        const character = {
            scene: {},
            sayStackView: { getHeight: () => 90 },
            cancelPreviousEmote: vi.fn(),
            createStartTransition: vi.fn(),
            add: vi.fn(),
        };
        Character.prototype.playEmote.call(character as unknown as CharacterType, "👍");
        expect(character.createStartTransition).toHaveBeenCalledWith(-150);
    });

    it.each(["<b>x</b>", "<img src=x onerror=alert(1)>", "<svg onload=alert(1)></svg>"])(
        "displays remote payload %s literally",
        (emote) => {
            const add = vi.fn();
            const character = {
                scene: {},
                cancelPreviousEmote: vi.fn(),
                createStartTransition: vi.fn(),
                add,
            };
            Character.prototype.playEmote.call(character as unknown as InstanceType<typeof Character>, emote);
            const node = (add.mock.calls[0][0] as DOMElement).node;
            expect(node.textContent).toBe(emote);
            expect(node.childElementCount).toBe(0);
        }
    );

    it.each(["👍", "❤️", "😂", "👏", "😍", "🙏", "👨‍👩‍👧‍👦", "👋🏽", "🇰🇼"])(
        "keeps emoji %s and the animation path",
        (emote) => {
            const add = vi.fn();
            const character = {
                scene: {},
                cancelPreviousEmote: vi.fn(),
                createStartTransition: vi.fn(),
                add,
            };
            Character.prototype.playEmote.call(character as unknown as InstanceType<typeof Character>, emote);
            expect((add.mock.calls[0][0] as DOMElement).node.textContent).toBe(emote);
            expect(character.cancelPreviousEmote).toHaveBeenCalledOnce();
            expect(character.createStartTransition).toHaveBeenCalledWith(-45);
        }
    );

    it("draws the emote in front of the player name layer but behind the UI", () => {
        const add = vi.fn();
        const character = {
            scene: {},
            cancelPreviousEmote: vi.fn(),
            createStartTransition: vi.fn(),
            add,
        };
        Character.prototype.playEmote.call(character as unknown as InstanceType<typeof Character>, "👍");
        const { depth } = add.mock.calls[0][0] as DOMElement;
        expect(depth).toBe(DEPTH_EMOTE_INDEX);
        expect(depth).toBeGreaterThan(DEPTH_INGAME_TEXT_INDEX);
        expect(depth).toBeLessThan(DEPTH_UI_INDEX);
    });
});
