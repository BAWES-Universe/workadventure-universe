import { tick } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import type { BotData } from "../../types";
import BotFooter from "./BotFooter.svelte";

const bot: BotData = {
    id: "b1",
    name: "Studio Brick",
    behaviorConfig: { assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } },
    createdAt: "2026-10-12T09:00:00Z",
    updatedAt: "2026-11-06T09:00:00Z",
    createdBy: { id: "u1", name: "Khalid", email: null },
    updatedBy: { id: "u1", name: "Khalid", email: null },
};

describe("Delete on a Brick's page (#1996, mock d-2)", () => {
    let target: HTMLElement;
    let footer: BotFooter | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        footer?.$destroy();
        target.remove();
    });

    async function ask(props: Record<string, unknown>) {
        target = document.createElement("div");
        document.body.appendChild(target);
        footer = new BotFooter({ target, props: { bot, onDelete: () => {}, ...props } });
        target.querySelector<HTMLElement>('[data-testid="brickDelete"]')?.click();
        await tick();
    }
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    it("offers its computer's files first, with their size and Download", async () => {
        const download = vi.fn();
        await ask({ brick: { undoLine: "You can undo this until 17 Nov, on the Bricks page.", files: { size: "1.2 GB", download } } });
        const files = byId("brickDeleteFiles");
        expect(files?.textContent?.replace(/\s+/g, " ").trim()).toBe("Its files 1.2 GB on its computer Download");
        byId("brickDeleteDownload")?.click();
        expect(download).toHaveBeenCalledTimes(1);
        expect(byId("brickDeleteUndoLine")?.textContent).toBe("You can undo this until 17 Nov, on the Bricks page.");
        expect(byId("brickDeleteConfirm")?.textContent?.trim()).toBe("Delete Brick");
    });

    it("asks a room bot's question as before", async () => {
        target = document.createElement("div");
        document.body.appendChild(target);
        footer = new BotFooter({ target, props: { bot, onDelete: () => {} } });
        expect(byId("brickDelete")).toBeNull();
        byId("bot-delete")?.click();
        await tick();
        expect(byId("brickDeleteAsk")).toBeNull();
        expect(target.textContent).toContain("Delete Studio Brick? This can't be undone.");
    });
});
