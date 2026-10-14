// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import ReconnectPill from "../ReconnectPill.svelte";
import ReconnectRoomPicture from "../ReconnectRoomPicture.svelte";
import { softReconnect } from "../../../Connection/SoftReconnect";

// The tests run Svelte's server build; the pill needs the browser one.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));

vi.mock("../../../../i18n/i18n-svelte", async () => (await import("../../Woka/tests/i18nStub")).i18nStub);

describe("the pill and the room kept on screen while the game gets back in (#958)", () => {
    const mounted: { $destroy(): void }[] = [];
    afterEach(() => {
        vi.useRealTimers();
        mounted.splice(0).forEach((component) => component.$destroy());
        softReconnect.cancel();
        document.body.innerHTML = "";
    });

    function mount() {
        const target = document.createElement("div");
        document.body.append(target);
        mounted.push(new ReconnectRoomPicture({ target }), new ReconnectPill({ target }));
        return target;
    }

    it("shows the room picture with the names and the bar, then the pill's three states", async () => {
        vi.useFakeTimers();
        const target = mount();
        const names = document.createElement("div");
        names.innerHTML = '<div class="username-display">Sara</div>';
        const ui = document.createElement("div");
        ui.innerHTML = "<button>Menu</button>";
        softReconnect.start(
            { src: "data:image/png;base64,AAAA", left: 0, top: 12, width: 428, height: 900, names, ui },
            () => undefined
        );
        await tick();

        const picture = target.querySelector<HTMLElement>("[data-testid=reconnect-room-picture]");
        expect(picture?.querySelector("img")?.getAttribute("style")).toContain("top: 12px");
        expect(picture?.textContent).toContain("Sara");
        // The bar as it was: there, and its taps wait.
        // (Svelte sets inert as a property; jsdom does not reflect it to the attribute.)
        const bar = target.querySelector("button")?.closest<HTMLElement & { inert?: boolean }>(".contents");
        expect(bar?.inert).toBe(true);
        expect(target.querySelector("[data-testid=reconnect-pill]")).toBeNull();

        vi.advanceTimersByTime(1_000);
        await tick();
        let pill = target.querySelector<HTMLElement>("[data-testid=reconnect-pill]");
        expect(pill?.dataset.state).toBe("reconnecting");
        expect(pill?.textContent).toContain("warning.reconnectingTitle");
        expect(pill?.getAttribute("role")).toBe("status");

        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
        window.dispatchEvent(new Event("offline"));
        await tick();
        pill = target.querySelector<HTMLElement>("[data-testid=reconnect-pill]");
        expect(pill?.dataset.state).toBe("offline");
        expect(pill?.textContent).toContain("warning.offlineTitle");
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });

        softReconnect.finish();
        await tick();
        expect(target.querySelector("[data-testid=reconnect-room-picture]")).toBeNull();
        pill = target.querySelector<HTMLElement>("[data-testid=reconnect-pill]");
        expect(pill?.dataset.state).toBe("back");
        expect(pill?.textContent).toContain("warning.backIn");
    });
});
