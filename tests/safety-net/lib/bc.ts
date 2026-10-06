import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, withFrontModule } from "./game";

const MAP_STORAGE = process.env.SAFETY_NET_MAP_STORAGE ?? "http://localhost:3000";
const MAP_STORAGE_AUTH = "Basic " + Buffer.from("john.doe:password").toString("base64");

/** A second fresh map-storage room for the same test (same world as wamRoom's). */
export async function otherWamRoom(testInfo: TestInfo, suffix: string, map = "empty"): Promise<string> {
    const slug = `sn-${testInfo.project.name}-${testInfo.testId}-${testInfo.retry}-${suffix}`
        .replace(/[^a-zA-Z0-9-]/g, "")
        .slice(0, 70);
    const destination = `/e2e/tests/maps/${slug}.wam`;
    await fetch(MAP_STORAGE + destination, { method: "DELETE", headers: { Authorization: MAP_STORAGE_AUTH } });
    const res = await fetch(MAP_STORAGE + "/copy", {
        method: "POST",
        headers: { Authorization: MAP_STORAGE_AUTH, "Content-Type": "application/json" },
        body: JSON.stringify({ source: `/e2e/tests/maps/${map}.wam`, destination }),
    });
    if (res.status !== 201) throw new Error(`map-storage copy failed: ${res.status} ${await res.text()}`);
    return `/~${destination}`;
}

/** The room's name as the Broadcast card shows it: the last part of the room URL. */
export function roomNameOf(url: string): string {
    const parts = url.split("/").filter((part) => part !== "");
    return parts[parts.length - 1];
}

export function panel(page: Page): Locator {
    return page.getByTestId("broadcast-panel");
}

/** Opens the Tools menu: the Tools pill, or the profile menu when Tools fell into it. */
export async function openTools(page: Page): Promise<void> {
    if (await page.getByTestId("map-menu").isVisible()) await page.getByTestId("map-menu").click();
    else await page.getByTestId("action-user").getByRole("button").first().click();
    await expect(page.getByTestId("broadcast-menu")).toBeVisible();
}

export async function openBroadcast(page: Page): Promise<void> {
    await openTools(page);
    await page.getByTestId("broadcast-menu").click();
    await expect(panel(page)).toBeVisible();
}

export async function primeAdmin(page: Page): Promise<void> {
    await withFrontModule(page, "src/front/Stores/GameStore.ts", "m => m.userIsAdminStore.set(true)");
}

export interface PrimedCard {
    senderName: string;
    reach: string;
    reachLabel?: string;
    html?: string;
    audioUrl?: string;
}

export async function primeCard(page: Page, card: PrimedCard): Promise<void> {
    const full = { reachLabel: undefined, html: undefined, audioUrl: undefined, ...card };
    await withFrontModule(
        page,
        "src/front/Stores/BroadcastStore.ts",
        `m => m.broadcastInboxStore.add(${JSON.stringify(full)})`
    );
}

async function setSwitch(page: Page, testId: string, on: boolean): Promise<void> {
    const toggle = page.getByTestId(testId);
    if ((await toggle.getAttribute("aria-checked")) !== String(on)) await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", String(on));
}

export interface BroadcastSetup {
    who?: "admins" | "everyone" | "tags";
    tags?: string[];
    room?: boolean;
    world?: boolean;
}

/** Broadcast settings from the What step: who may go live and which reaches are on, then Save. */
export async function saveSettings(page: Page, setup: BroadcastSetup): Promise<void> {
    if (!(await panel(page).isVisible())) await openBroadcast(page);
    await page.getByTestId("broadcast-settings").click();
    await expect(panel(page).getByRole("dialog", { name: "Broadcast settings" })).toBeVisible();
    await page.getByTestId(`broadcast-settings-who-${setup.who ?? "everyone"}`).click();
    for (const tag of setup.tags ?? []) {
        if (!(await page.getByTestId("broadcast-settings-tag").isVisible())) {
            await page.getByTestId("broadcast-settings-add-tag").click();
        }
        await page.getByTestId("broadcast-settings-tag").fill(tag);
        await page.getByTestId("broadcast-settings-tag").press("Enter");
    }
    await setSwitch(page, "broadcast-settings-reach-ROOM", setup.room ?? true);
    await setSwitch(page, "broadcast-settings-reach-WORLD", setup.world ?? false);
    await page.getByTestId("broadcast-settings-save").click();
    await expect(panel(page).getByRole("dialog", { name: "Broadcast" })).toBeVisible();
}

/** Turns broadcasting on (Everyone, This room by default) and waits until Go live can be used. */
export async function turnOnBroadcast(page: Page, setup: BroadcastSetup = {}): Promise<void> {
    await saveSettings(page, setup);
    await expect(page.getByTestId("broadcast-kind-live")).toBeEnabled();
}

/** Go live from the What step on the given reach (the Who step shows only when there is a choice). */
export async function openGoLive(page: Page, reach?: "ROOM" | "WORLD"): Promise<void> {
    await page.getByTestId("broadcast-kind-live").click();
    if (reach && (await page.getByTestId("broadcast-next").isVisible())) {
        await page.getByTestId(`broadcast-reach-${reach}`).click();
        await page.getByTestId("broadcast-next").click();
    }
    await expect(page.getByTestId("broadcast-go-live")).toBeVisible();
}

export async function goLive(page: Page, reach?: "ROOM" | "WORLD"): Promise<void> {
    await openGoLive(page, reach);
    await expect(page.getByTestId("broadcast-go-live")).toBeEnabled();
    await page.getByTestId("broadcast-go-live").click();
    await expect(page.getByTestId("broadcast-live-pill")).toBeVisible();
}

/** A mono 16-bit WAV of a sine tone, for "Use a file" and primed voice cards. */
export function wavBuffer(seconds = 2, sampleRate = 8000): Buffer {
    const samples = Math.floor(seconds * sampleRate);
    const buffer = Buffer.alloc(44 + samples * 2);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + samples * 2, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) {
        buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000), 44 + i * 2);
    }
    return buffer;
}

/**
 * A fresh map-storage room (empty 10x10 map) with a Stage area in the top-left corner (0,0 to 96,96) and an
 * Audience area linked to it in the bottom-right corner (224,224 to 320,320).
 */
export async function stageRoom(testInfo: TestInfo): Promise<string> {
    const url = await otherWamRoom(testInfo, "stage");
    const path = url.replace(/^\/~/, "");
    const res = await fetch(MAP_STORAGE + path, { headers: { Authorization: MAP_STORAGE_AUTH } });
    if (!res.ok) throw new Error(`map-storage read failed: ${res.status}`);
    const wam = await res.json();
    const stageId = crypto.randomUUID();
    wam.areas = [
        {
            id: stageId,
            name: "Stage",
            x: 0,
            y: 0,
            width: 96,
            height: 96,
            visible: true,
            properties: [{ id: crypto.randomUUID(), type: "speakerMegaphone", name: "Main stage", chatEnabled: false }],
        },
        {
            id: crypto.randomUUID(),
            name: "Audience",
            x: 224,
            y: 224,
            width: 96,
            height: 96,
            visible: true,
            properties: [
                { id: crypto.randomUUID(), type: "listenerMegaphone", speakerZoneName: stageId, chatEnabled: false },
            ],
        },
    ];
    const put = await fetch(MAP_STORAGE + path, {
        method: "PUT",
        headers: { Authorization: MAP_STORAGE_AUTH, "Content-Type": "application/json" },
        body: JSON.stringify(wam),
    });
    if (!put.ok) throw new Error(`map-storage write failed: ${put.status} ${await put.text()}`);
    return url;
}
