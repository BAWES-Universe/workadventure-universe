import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UsernameDomLayerClient, UsernameDomLayerHost } from "../../Game/UsernameDomLayer";
import { RaisedHandBadge } from "../RaisedHandBadge";

class FakeLayer implements UsernameDomLayerHost {
    public readonly container = document.createElement("div");
    public readonly clients = new Set<UsernameDomLayerClient>();
    public readonly transformRequests: UsernameDomLayerClient[] = [];
    public readonly stylesRequests: UsernameDomLayerClient[] = [];
    public ancestorScale = 3;

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
        return 1;
    }
}

describe("RaisedHandBadge", () => {
    let layer: FakeLayer;
    let badge: RaisedHandBadge;

    const element = (): HTMLElement | null => layer.container.querySelector<HTMLElement>(".raised-hand-badge");

    beforeEach(() => {
        layer = new FakeLayer();
        badge = new RaisedHandBadge(layer);
    });

    afterEach(() => {
        badge.destroy();
    });

    it("adds nothing to the layer until the hand goes up", () => {
        badge.setPosition(10, 20);
        badge.showPlace(undefined);
        expect(element()).toBeNull();
        expect(layer.clients.size).toBe(0);
        expect(badge.isShown()).toBe(false);
    });

    it("shows the hand and the place in line, as page elements in the names layer", () => {
        badge.showPlace(2);
        expect(element()?.classList.contains("is-shown")).toBe(true);
        expect(element()?.querySelector(".raised-hand-badge-icon")?.textContent).toBe("✋");
        expect(element()?.querySelector(".raised-hand-badge-number")?.textContent).toBe("2");
        expect(layer.clients.has(badge)).toBe(true);
        expect(layer.stylesRequests).toContain(badge);
    });

    it("shows the hand alone while the place isn't known yet, and hides it when the hand goes down", () => {
        badge.showPlace(0);
        expect(element()?.querySelector(".raised-hand-badge-number")?.textContent).toBe("");
        badge.showPlace(undefined);
        expect(element()?.classList.contains("is-shown")).toBe(false);
        expect(badge.isShown()).toBe(false);
    });

    it("is laid out at its size on screen and brought back down by its own transform, to stay sharp", () => {
        badge.showPlace(1);
        badge.setPosition(100, 50);
        badge.applyStyles();
        expect(element()?.style.getPropertyValue("--raised-hand-scale")).toBe("3");
        expect(element()?.style.transform).toBe(`translate3d(100px, 50px, 0) translate(-50%, -50%) scale(${1 / 3})`);
    });

    it("is not magnified by its own transform when zoomed out", () => {
        layer.ancestorScale = 0.5;
        badge.showPlace(1);
        badge.applyStyles();
        expect(element()?.style.getPropertyValue("--raised-hand-scale")).toBe("1");
        expect(element()?.style.transform).toContain("scale(1)");
    });

    it("follows the player's depth and fading, and leaves the layer when destroyed", () => {
        badge.setPlayerDepth(120.4);
        badge.setFaded(true);
        badge.showPlace(3);
        expect(element()?.style.zIndex).toBe("120");
        expect(element()?.style.opacity).toBe("0.45");
        badge.destroy();
        expect(element()).toBeNull();
        expect(layer.clients.size).toBe(0);
    });
});
