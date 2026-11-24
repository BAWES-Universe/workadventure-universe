import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import type { BotData } from "../../types";
import MovesGroup from "./MovesGroup.svelte";

const bot = {
    id: "b1",
    name: "Brick",
    characterTexture: "",
    behaviorType: "patrol",
    behaviorConfig: {
        behaviorType: "patrol",
        moves: "route",
        loop: true,
        pauseAtWaypoints: 5,
        patrolWaypoints: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
        ],
        assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
    },
    aiProviderRef: "universe-ai",
    chatInstructions: "",
    enabled: true,
} as unknown as BotData;

function open(brick: boolean) {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const onEditRoute = vi.fn();
    const view = new MovesGroup({
        target,
        props: { bot, open: true, onToggle: () => {}, onChange: () => {}, onEditRoute, brick },
    });
    return { target, view, onEditRoute };
}

describe("a route on the Moves group", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("on a Brick's page shows the saved route's stops, loop and pause, and offers no Edit route", async () => {
        const { target, view } = open(true);
        await tick();
        expect(target.querySelector("[data-testid='bot-edit-route']")).toBeNull();
        // The stops row, the direction and the pause are still there
        expect(target.textContent).toMatch(/2/);
        expect(target.querySelectorAll("button").length).toBeGreaterThan(2);
        view.$destroy();
    });

    it("on a room bot's page still offers Edit route, which starts editing the route", async () => {
        const { target, view, onEditRoute } = open(false);
        await tick();
        const edit = target.querySelector<HTMLButtonElement>("[data-testid='bot-edit-route']");
        expect(edit).not.toBeNull();
        edit?.click();
        expect(onEditRoute).toHaveBeenCalledTimes(1);
        view.$destroy();
    });
});
