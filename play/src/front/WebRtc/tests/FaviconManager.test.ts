import { afterEach, describe, expect, it } from "vitest";
import { FaviconManager } from "../FaviconManager";

const ICON_URL = "https://admin.example.com/assets/favicon-trans-512x512.png";

function addIconLink(href: string): HTMLLinkElement {
    const link = document.createElement("link");
    link.rel = "icon";
    link.setAttribute("sizes", "512x512");
    link.href = href;
    document.head.appendChild(link);
    return link;
}

describe("FaviconManager", () => {
    afterEach(() => {
        document.head.innerHTML = "";
    });

    it("keeps the icon link and its original href after a bubble ends", () => {
        const link = addIconLink(ICON_URL);
        const manager = new FaviconManager();

        manager.pushNotificationFavicon();
        link.href = "data:image/png;base64,badged";
        manager.pushOriginalFavicon();

        const links = document.querySelectorAll<HTMLLinkElement>("link[rel~='icon']");
        expect(links).toHaveLength(1);
        expect(links[0]).toBe(link);
        expect(link.href).toBe(ICON_URL);
    });

    it("restores the first original href across repeated notifications", () => {
        const link = addIconLink(ICON_URL);
        const manager = new FaviconManager();

        manager.pushNotificationFavicon();
        link.href = "data:image/png;base64,badged";
        manager.pushNotificationFavicon();
        manager.pushOriginalFavicon();

        expect(link.href).toBe(ICON_URL);
    });

    it("leaves the favicon alone when no notification was shown", () => {
        const link = addIconLink(ICON_URL);
        const manager = new FaviconManager();

        manager.pushOriginalFavicon();

        expect(document.querySelectorAll("link[rel~='icon']")).toHaveLength(1);
        expect(link.href).toBe(ICON_URL);
    });
});
