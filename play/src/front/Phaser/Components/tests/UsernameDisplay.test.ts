import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvailabilityStatus } from "@workadventure/messages";
import type { UsernameDomLayerClient, UsernameDomLayerHost } from "../../Game/UsernameDomLayer";
import { UsernameDisplay } from "../UsernameDisplay";

class FakeLayer implements UsernameDomLayerHost {
    public readonly container = document.createElement("div");
    public readonly clients = new Set<UsernameDomLayerClient>();
    public readonly transformRequests: UsernameDomLayerClient[] = [];
    public readonly stylesRequests: UsernameDomLayerClient[] = [];
    public ancestorScale = 1.25;
    public zoomModifier = 1;

    addUsername(element: HTMLElement): void {
        this.container.appendChild(element);
    }
    register(client: UsernameDomLayerClient): void {
        this.clients.add(client);
    }
    unregister(client: UsernameDomLayerClient): void {
        this.clients.delete(client);
    }
    requestTransform(client: UsernameDomLayerClient): void {
        this.transformRequests.push(client);
    }
    requestStyles(client: UsernameDomLayerClient): void {
        this.stylesRequests.push(client);
    }
    getAncestorScale(): number {
        return this.ancestorScale;
    }
    getZoomModifier(): number {
        return this.zoomModifier;
    }
}

describe("UsernameDisplay", () => {
    let layer: FakeLayer;
    let display: UsernameDisplay;
    let onLayoutChanged: () => void;

    const pill = (): HTMLElement => {
        const element = layer.container.querySelector<HTMLElement>(".username-display");
        if (!element) {
            throw new Error("no pill");
        }
        return element;
    };

    beforeEach(() => {
        layer = new FakeLayer();
        onLayoutChanged = vi.fn();
        display = new UsernameDisplay(layer, 100, 200, "Khalid", onLayoutChanged);
    });

    afterEach(() => {
        display.destroy();
    });

    it("adds one pill with the name to the layer and asks to be laid out again at render time", () => {
        expect(layer.container.querySelectorAll(".username-display")).toHaveLength(1);
        expect(pill().textContent).toBe("Khalid");
        expect(layer.clients.has(display)).toBe(true);
        expect(layer.stylesRequests).toContain(display);
    });

    it("lays the pill out in game pixels scaled by the layer", () => {
        // Ancestor scale 1.25: the pill is magnified by 1, and laid out at full size.
        expect(display.getPillHeight()).toBeCloseTo(16);
        expect(pill().style.height).toBe("20px");
        expect(pill().style.getPropertyValue("--username-dom-scale")).toBe("1.25");
    });

    it("keeps the pill's height readable when zoomed far out", () => {
        layer.zoomModifier = 0.5;
        layer.ancestorScale = 0.625;
        display.applyStyles();
        // 16 game px at a 1.3 scale: still 13 px of font on a 0.625 screen scale.
        expect(display.getPillHeight()).toBeCloseTo(20.8);
    });

    it("places the pill's bottom on the given y, centred on x", () => {
        display.applyTransform();
        // y = 200 - 16 / 2 = 192, then centred on its own box.
        expect(pill().style.transform).toBe("translate3d(100px, 192px, 0) translate(-50%, -50%) scale(0.8)");
    });

    it("asks for a new transform only when the position changes", () => {
        layer.transformRequests.length = 0;
        display.setPosition(100, 200);
        expect(layer.transformRequests).toHaveLength(0);
        display.setPosition(101, 200);
        expect(layer.transformRequests).toEqual([display]);
    });

    it("shows the status dot in the status colour with a border in the outline colour", () => {
        const dot = pill().querySelector<HTMLElement>("span");
        expect(dot?.style.backgroundColor).toBe("rgb(104, 233, 122)");
        display.setAvailabilityStatus(AvailabilityStatus.DO_NOT_DISTURB, true);
        expect(dot?.style.backgroundColor).toBe("rgb(233, 110, 83)");
        expect(dot?.style.borderColor).toBe("#cc5151");
        expect(display.getAvailabilityStatus()).toBe(AvailabilityStatus.DO_NOT_DISTURB);
    });

    it("gives the dot a border of at least one screen pixel, and .12f", () => {
        // 1.2 game px at a 1.25 screen scale is 1.5 screen px, laid out at 1.25.
        expect(pill().style.getPropertyValue("--username-dot-border")).toBe("1.5px");
        layer.ancestorScale = 0.6;
        layer.zoomModifier = 0.48;
        display.applyStyles();
        // Zoomed far out the border would shrink under a pixel: it stays one screen pixel.
        expect(parseFloat(pill().style.getPropertyValue("--username-dot-border"))).toBeGreaterThanOrEqual(1);
    });

    it("shows the same pill for every status: only the dot changes", () => {
        const classes = pill().className;
        const background = pill().style.background;
        for (const status of [AvailabilityStatus.AWAY, AvailabilityStatus.BUSY, AvailabilityStatus.SILENT]) {
            display.setAvailabilityStatus(status, true);
            expect(pill().className).toBe(classes);
            expect(pill().style.background).toBe(background);
        }
    });

    it("cuts names over 32 letters and shows them whole when highlighted", () => {
        const name = "Juanma Gaviria Restrepo Hernandez Lopez";
        const long = new UsernameDisplay(layer, 0, 0, name);
        const longPill = layer.container.querySelectorAll<HTMLElement>(".username-display")[1];
        expect(longPill.textContent).toBe("Juanma Gaviria Restrepo Hernand…");
        long.setHighlighted(true);
        expect(longPill.textContent).toBe(name);
        long.setHighlighted(false);
        expect(longPill.textContent).toBe("Juanma Gaviria Restrepo Hernand…");
        long.destroy();
    });

    it("highlights: lighter pill, in front of the others, same size", () => {
        display.setPlayerDepth(300);
        display.applyTransform();
        const restingTransform = pill().style.transform;
        expect(restingTransform).toMatch(/scale\(0\.8\)/);
        expect(pill().style.zIndex).toBe("300");
        display.setHighlighted(true);
        expect(pill().classList.contains("is-highlighted")).toBe(true);
        expect(Number(pill().style.zIndex)).toBeGreaterThan(1_000_000_000);
        display.applyTransform();
        expect(pill().style.transform).toBe(restingTransform);
        display.setHighlighted(false);
        expect(pill().classList.contains("is-highlighted")).toBe(false);
        expect(pill().style.zIndex).toBe("300");
    });

    it("keeps a script's colour off a highlighted pill", () => {
        display.setCustomColor(0x336699);
        expect(pill().style.background).toBe("rgb(51, 102, 153)");
        display.setHighlighted(true);
        expect(pill().style.background).toBe("");
        display.setHighlighted(false);
        expect(pill().style.background).toBe("rgb(51, 102, 153)");
        display.setCustomColor(undefined);
        expect(pill().style.background).toBe("");
    });

    it("shows the talk bubble above the pill and tells the character to move its badges", () => {
        const bubble = pill().querySelector<HTMLElement>(".username-talk-bubble");
        expect(bubble?.style.display).toBe("none");
        expect(bubble?.querySelectorAll("i")).toHaveLength(3);
        (onLayoutChanged as ReturnType<typeof vi.fn>).mockClear();
        display.setTalking(true);
        expect(bubble?.style.display).toBe("flex");
        expect(display.isTalking()).toBe(true);
        expect(onLayoutChanged).toHaveBeenCalled();
        display.setTalking(false, true);
        expect(bubble?.style.display).toBe("none");
        expect(display.isTalking()).toBe(false);
    });

    it("stands the bubble's top above the pill's top", () => {
        // 15.5 game px of bubble, plus the gap: 3 screen px (2.4 game px at 1.25) and .3f (3 game px).
        expect(display.getBubbleExtent()).toBeCloseTo(15.5 + 2.4 + 3);
    });

    it("grows the megaphone in the pill", () => {
        const megaphone = pill().querySelector<HTMLImageElement>("img");
        expect(megaphone?.style.display).toBe("none");
        display.setMegaphone(true, true);
        expect(megaphone?.style.display).toBe("");
        display.setMegaphone(false, true);
        expect(megaphone?.style.display).toBe("none");
    });

    it("leaves the layer when destroyed", () => {
        display.destroy();
        expect(layer.container.querySelector(".username-display")).toBeNull();
        expect(layer.clients.has(display)).toBe(false);
    });

    describe("reduced motion", () => {
        const animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve(), onfinish: null }));

        const setReducedMotion = (reduce: boolean): void => {
            vi.stubGlobal(
                "matchMedia",
                vi.fn(() => ({ matches: reduce }))
            );
        };

        beforeEach(() => {
            animate.mockClear();
            Object.defineProperty(HTMLElement.prototype, "animate", {
                value: animate,
                configurable: true,
                writable: true,
            });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
            Reflect.deleteProperty(HTMLElement.prototype, "animate");
        });

        it("plays no animation for a status change or the megaphone when the player asked for reduced motion", () => {
            setReducedMotion(true);
            display.setAvailabilityStatus(AvailabilityStatus.AWAY);
            display.setMegaphone(true);
            expect(animate).not.toHaveBeenCalled();
            expect(pill().querySelector<HTMLImageElement>("img")?.style.display).toBe("");
            expect(display.getAvailabilityStatus()).toBe(AvailabilityStatus.AWAY);
        });

        it("animates a status change and the megaphone otherwise", () => {
            setReducedMotion(false);
            display.setAvailabilityStatus(AvailabilityStatus.AWAY);
            display.setMegaphone(true);
            expect(animate).toHaveBeenCalledTimes(2);
        });
    });
});
