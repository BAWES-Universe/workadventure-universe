import { describe, expect, it } from "vitest";
import { createLayerPictures } from "./LayerPictures";

describe("createLayerPictures", () => {
    const body = { id: "body", url: "https://assets.test/body.png" };
    const hat = { id: "hat", url: "https://assets.test/hat.png" };

    it("gives nothing to someone without layers, so the caller falls back", () => {
        const pictureOf = createLayerPictures();
        expect(pictureOf({ uuid: "a" })).toBeUndefined();
        expect(pictureOf({ uuid: "a", characterTextures: [] })).toBeUndefined();
    });

    it("keeps one picture per person while the same layers are shown, and draws a new one when they change", () => {
        const pictureOf = createLayerPictures();
        const first = pictureOf({ uuid: "a", characterTextures: [body, hat] });
        expect(first).toBeDefined();
        expect(pictureOf({ uuid: "a", characterTextures: [{ ...body }, { ...hat }] })).toBe(first);
        expect(pictureOf({ uuid: "b", characterTextures: [body, hat] })).not.toBe(first);
        expect(pictureOf({ uuid: "a", characterTextures: [body] })).not.toBe(first);
    });
});
