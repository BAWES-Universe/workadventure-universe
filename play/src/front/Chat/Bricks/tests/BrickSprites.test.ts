import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BRICK_LOOKS, isBrickLook, wokasToWear } from "../Brick";

/**
 * What the map draws for a Brick: one 96x128 sheet per colour in the Woka format (3 frames across, 4 directions down),
 * at resources/characters/bricks/<look>.png, the address Orbit's catalog gives each Brick look. The game's own walk
 * (frames 0, 1, 2, 1 at 10 fps) then reads as a hop: rest, rest, up 4 px, rest.
 */
const SHEETS = join(__dirname, "../../../../../public/resources/characters/bricks");

interface Sheet {
    width: number;
    height: number;
    /** RGBA, row by row */
    pixels: Uint8Array;
}

/** A plain 8-bit RGBA PNG, which is how the sheets are made. */
function readSheet(look: string): Sheet {
    const file = readFileSync(join(SHEETS, `${look}.png`));
    expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    let at = 8;
    let width = 0;
    let height = 0;
    const parts: Buffer[] = [];
    while (at < file.length) {
        const length = file.readUInt32BE(at);
        const type = file.subarray(at + 4, at + 8).toString("latin1");
        const data = file.subarray(at + 8, at + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            expect({ depth: data[8], colour: data[9], interlace: data[12] }).toEqual({
                depth: 8,
                colour: 6,
                interlace: 0,
            });
        }
        if (type === "IDAT") parts.push(data);
        at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(parts));
    const stride = width * 4;
    const pixels = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let x = 0; x < stride; x++) {
            const value = raw[y * (stride + 1) + 1 + x];
            const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
            const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
            let predicted = 0;
            if (filter === 1) predicted = left;
            else if (filter === 2) predicted = up;
            else if (filter === 3) predicted = (left + up) >> 1;
            else if (filter === 4) {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
            }
            pixels[y * stride + x] = (value + predicted) & 255;
        }
    }
    return { width, height, pixels };
}

/** The alpha of a pixel in the frame at this column and row of the sheet. */
function alphaAt(sheet: Sheet, column: number, row: number, x: number, y: number): number {
    return sheet.pixels[((row * 32 + y) * sheet.width + column * 32 + x) * 4 + 3];
}

/** Where the solid body is (the shadow is see-through): its top and bottom rows, and the rows and width of the shadow. */
function measure(sheet: Sheet, column: number, row: number) {
    let top = 99;
    let bottom = -1;
    const shadowRows = new Set<number>();
    for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
            const alpha = alphaAt(sheet, column, row, x, y);
            if (alpha === 255) {
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
            } else if (alpha > 0) {
                shadowRows.add(y);
            }
        }
    }
    // How wide the shadow is on its lowest row, where nothing covers it
    const lowest = Math.max(...shadowRows);
    let shadowWidth = 0;
    for (let x = 0; x < 32; x++) {
        const alpha = alphaAt(sheet, column, row, x, lowest);
        if (alpha > 0 && alpha < 255) shadowWidth++;
    }
    return { top, bottom, shadowRows: [...shadowRows], shadowWidth };
}

function frame(sheet: Sheet, column: number, row: number): string {
    const rows: string[] = [];
    for (let y = 0; y < 32; y++) {
        const start = ((row * 32 + y) * sheet.width + column * 32) * 4;
        rows.push(Buffer.from(sheet.pixels.subarray(start, start + 128)).toString("hex"));
    }
    return rows.join("");
}

describe("the Brick map sprites", () => {
    it("has one 96x128 sheet for each of the twelve Brick colours", () => {
        expect(BRICK_LOOKS).toHaveLength(12);
        for (const look of BRICK_LOOKS) {
            const sheet = readSheet(look);
            expect({ look, width: sheet.width, height: sheet.height }).toEqual({ look, width: 96, height: 128 });
        }
    });

    it("rests in the first two frames and hops 4 px in the third, in all four directions", () => {
        for (const look of BRICK_LOOKS) {
            const sheet = readSheet(look);
            for (let row = 0; row < 4; row++) {
                // Column 0 is the still picture and column 1 the game's idle frame: the same Brick at rest
                expect(frame(sheet, 0, row)).toBe(frame(sheet, 1, row));
                const rest = measure(sheet, 1, row);
                const air = measure(sheet, 2, row);
                // The body is lifted exactly 4 px; the shadow stays on the floor, and is smaller
                expect({ look, row, lift: rest.bottom - air.bottom }).toEqual({ look, row, lift: 4 });
                // (more of it shows in the air, the body no longer covers it, but its lowest row is the same)
                expect(Math.max(...air.shadowRows)).toBe(Math.max(...rest.shadowRows));
                expect(air.shadowWidth).toBeLessThan(rest.shadowWidth);
                // Nothing touches the edge of the 32x32 frame: the engine places the frame, not the drawing
                expect(rest.top).toBeGreaterThan(0);
                expect(air.top).toBeGreaterThan(0);
                expect(Math.max(...rest.shadowRows)).toBeLessThan(32);
            }
        }
    });

    it("looks different in each colour and turns its eyes with its direction", () => {
        const colours = new Set<string>();
        for (const look of BRICK_LOOKS) {
            const sheet = readSheet(look);
            colours.add(frame(sheet, 1, 0));
            // down, left, right and up are four different pictures, up showing no eyes
            const faces = new Set([0, 1, 2, 3].map((row) => frame(sheet, 1, row)));
            expect(faces.size).toBe(4);
        }
        expect(colours.size).toBe(12);
    });
});

describe("wokasToWear", () => {
    const texture = (id: string) => ({ id, name: id, url: `resources/characters/${id}.png`, position: 0 });
    const catalog = {
        woka: {
            collections: [
                { name: "default", position: 0, textures: [texture("male1"), texture("female2")] },
                { name: "Bricks", position: 1, textures: BRICK_LOOKS.map(texture) },
            ],
        },
    } as unknown as Parameters<typeof wokasToWear>[0];

    it("leaves the Brick colours out of the WOKAs a Brick can wear", () => {
        expect(wokasToWear(catalog).map((one) => one.id)).toEqual(["male1", "female2"]);
        expect(BRICK_LOOKS.every(isBrickLook)).toBe(true);
    });

    it("is empty before the list is read", () => {
        expect(wokasToWear(null)).toEqual([]);
        expect(wokasToWear(undefined)).toEqual([]);
    });
});
