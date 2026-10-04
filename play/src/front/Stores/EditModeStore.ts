import type { ComponentType } from "svelte";
import { get, writable } from "svelte/store";
import type { EntityPrefab } from "@workadventure/map-editor";
import type { EntityVariant } from "../Phaser/Game/MapEditor/Entities/EntityVariant";
import { localUserStore } from "../Connection/LocalUserStore";
import { mapEditorSelectedEntityPrefabStore } from "./MapEditorStore";

/**
 * Stores of the "Editing a room" mode: the pill at the top, the rail of tools on the right edge, the panel beside it
 * and the bar at the bottom while something is being placed. The map editor engine (MapEditorModeManager and its
 * tools) stays as it is; these stores only carry what the new frame shows.
 */

/** Whether there is something to undo or redo, kept in step by the MapEditorModeManager. */
export const editUndoRedoStore = writable<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false });

/**
 * A tool another module adds to the rail (the bots module adds "Bots"). `id` is what mapEditorSelectedToolStore
 * carries while the tool is open; `onSelect` opens it. The module draws the panel contents itself.
 */
export interface EditTool {
    id: string;
    label: string;
    subtitle?: string;
    icon: ComponentType;
    onSelect: () => void;
}
export const editToolsStore = writable<EditTool[]>([]);
export function registerEditTool(tool: EditTool): () => void {
    editToolsStore.update((tools) => [...tools.filter((t) => t.id !== tool.id), tool]);
    return () => unregisterEditTool(tool.id);
}
export function unregisterEditTool(id: string): void {
    editToolsStore.update((tools) => tools.filter((t) => t.id !== id));
}

/** One action in the bar at the bottom while placing, moving or drawing. */
export interface PlacingAction {
    label: string;
    kind: "primary" | "secondary";
    testId?: string;
    onClick: () => void;
}
export interface PlacingBar {
    title: string;
    subtitle?: string;
    /** A picture of what is being placed, drawn at pixel size. */
    image?: string;
    /** Or an icon when there is no picture (a new area). */
    icon?: ComponentType;
    actions: PlacingAction[];
}
/** The bar at the bottom while a module places something (a bot, a route). The editor's own placing bar is drawn by its tools. */
export const editPlacingBarStore = writable<PlacingBar | undefined>(undefined);

/** The object picked in the Objects panel, with its colours and sides, so the placing bar can turn it or change its colour. */
export interface PickedVariant {
    variant: EntityVariant;
    color: string;
}
export const editPickedVariantStore = writable<PickedVariant | undefined>(undefined);

/** Turn the object being placed to its next side (R on a keyboard, "Turn" in the placing bar). True when it turned. */
export function turnPlacingPreview(): boolean {
    const picked = get(editPickedVariantStore);
    const current = get(mapEditorSelectedEntityPrefabStore);
    if (!picked || !current) return false;
    const sides = picked.variant.getEntityPrefabsPositions(picked.color);
    if (sides.length < 2) return false;
    const index = sides.findIndex((side) => side.id === current.id);
    const next = sides[(index + 1) % sides.length];
    mapEditorSelectedEntityPrefabStore.set(next);
    return true;
}

/** Change the colour of the object being placed, keeping its side when that colour has it. */
export function recolorPlacingPreview(color: string): void {
    const picked = get(editPickedVariantStore);
    const current = get(mapEditorSelectedEntityPrefabStore);
    if (!picked) return;
    const sides = picked.variant.getEntityPrefabsPositions(color);
    if (sides.length === 0) return;
    const sameSide = sides.find((side) => side.direction === current?.direction) ?? sides[0];
    editPickedVariantStore.set({ variant: picked.variant, color });
    mapEditorSelectedEntityPrefabStore.set(sameSide);
}

/** Where the preview waits on a phone, in screen pixels, for the "Tap again to place" pill. Undefined while nothing waits. */
export const editTouchPreviewStore = writable<{ x: number; y: number; width: number; height: number } | undefined>(
    undefined
);

/** The box being drawn for a new area, in world pixels, before it becomes an area. */
export interface AreaDraft {
    x: number;
    y: number;
    width: number;
    height: number;
}
export const editAreaDraftStore = writable<AreaDraft | undefined>(undefined);

/** Shown once per phone until the first tool is picked: "Pick a tool on the right..." */
function createEditHintSeenStore() {
    const { subscribe, set } = writable<boolean>(localUserStore.getEditHintSeen());
    return {
        subscribe,
        set: (value: boolean) => {
            if (value) localUserStore.setEditHintSeen(true);
            set(value);
        },
    };
}
export const editHintSeenStore = createEditHintSeenStore();

/** The last six objects placed, newest first, by prefab id, kept on this device. */
const RECENT_MAX = 6;
function createRecentObjectsStore() {
    const { subscribe, update } = writable<string[]>(localUserStore.getRecentEditObjects());
    return {
        subscribe,
        add: (prefab: EntityPrefab) => {
            update((ids) => {
                const next = [prefab.id, ...ids.filter((id) => id !== prefab.id)].slice(0, RECENT_MAX);
                localUserStore.setRecentEditObjects(next);
                return next;
            });
        },
    };
}
export const editRecentObjectsStore = createRecentObjectsStore();

/** Which view the Objects panel shows: the picker, the upload guide, the check of a picked file, or an object's settings. */
export type ObjectsPanelView = "pick" | "upload" | "settings";
export const editObjectsViewStore = writable<ObjectsPanelView>("pick");
