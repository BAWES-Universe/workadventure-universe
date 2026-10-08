import type { AreaData } from "@workadventure/map-editor";
import type { EditMapCommandMessage } from "@workadventure/messages";
import { get } from "svelte/store";
import { screenSpace } from "../ScreenSpace";
import { userIsAdminStore, userIsEditorStore } from "../../../../Stores/GameStore";
import { mapEditorSelectedAreaPreviewStore, mapEditorVisibilityStore } from "../../../../Stores/MapEditorStore";
import { editDeleteMarkStore, showUndoToast, type DeleteMark } from "../../../../Stores/EditModeStore";
import { LL } from "../../../../../i18n/i18n-svelte";
import { AreaPreview, AreaPreviewEvent } from "../../../Components/MapEditor/AreaPreview";
import { SizeAlteringSquare } from "../../../Components/MapEditor/SizeAlteringSquare";
import { Entity } from "../../../ECS/Entity";
import type { MapEditorModeManager } from "../MapEditorModeManager";
import { EntityRelatedEditorTool } from "./EntityRelatedEditorTool";
import type { AreaEditorTool } from "./AreaEditorTool";

/** The coral of the editor's delete accents: what a tap marked for removal is outlined in it. */
const MARK_COLOR = 0xf7a48f;

export class TrashEditorTool extends EntityRelatedEditorTool {
    protected ctrlKey?: Phaser.Input.Keyboard.Key;
    private areaPreviews: AreaPreview[] = [];
    private active = false;
    // On a phone a tap only marks: the item waits, outlined, for a second tap or the Remove chip. A tap elsewhere keeps it.
    private marked: Entity | AreaPreview | undefined;
    // On a computer the mouse shows what a click would remove; this only brings the "Click to remove" hint.
    private hovered: Entity | AreaPreview | undefined;
    /** What the current press started on: a click or a tap is a press and a release on the same item. */
    private pressed: Entity | AreaPreview | undefined;
    private lastMark: DeleteMark | undefined;
    /** The item the published mark belongs to: two items of the same size on the same spot must not share a mark. */
    private lastMarkTarget: Entity | AreaPreview | undefined;

    constructor(mapEditorModeManager: MapEditorModeManager, private areaEditorTool: AreaEditorTool) {
        super(mapEditorModeManager);

        this.active = false;
        this.ctrlKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);
    }

    public handleAreaDeletion(id: string, areaData: AreaData | undefined): void {
        this.scene.getGameMapFrontWrapper().listenAreaDeletion(areaData);

        if (!this.active) {
            return;
        }

        if (this.marked instanceof AreaPreview && this.marked.getId() === id) this.marked = undefined;
        if (this.hovered instanceof AreaPreview && this.hovered.getId() === id) this.hovered = undefined;
        this.deleteAreaPreview(id);
        this.scene.markDirty();
        mapEditorSelectedAreaPreviewStore.set(undefined);
        this.publishMark();
    }

    public handleAreaCreation(config: AreaData, localCommand: boolean): void {
        this.scene.getGameMapFrontWrapper().listenAreaCreation(config);

        if (!this.active) {
            return;
        }

        this.createAreaPreview(config);
        this.scene.markDirty();
    }

    public handleAreaPreviewCreation(config: AreaData, localCommand: boolean): void {
        console.info("handleAreaPreviewCreation => No create area preview in trash mode");
    }

    public activate() {
        super.activate();
        this.areaPreviews = this.createAreaPreviews();
        this.bindEventHandlers();
        this.active = true;
        this.setAreaPreviewsVisibility(this.getAreaPreviewVisibileFromUserPermissions());
        this.updateAreaPreviews();
        this.scene.markDirty();
        mapEditorVisibilityStore.set(false);
    }

    public clear() {
        super.clear();
        this.marked = undefined;
        this.hovered = undefined;
        this.publishMark();
        this.areaPreviews.forEach((preview) => preview.destroy());
        this.unbindEventHandlers();
        this.active = false;
        this.setAreaPreviewsVisibility(false);
        this.scene.markDirty();
    }

    public update(time: number, dt: number): void {
        super.update(time, dt);
        // The marked item may have gone (someone else removed it) or the camera may have moved under it.
        if (this.marked && !this.marked.scene) this.unmark();
        if (this.hovered && !this.hovered.scene) this.hovered = undefined;
        this.publishMark();
    }

    public handleKeyDownEvent(event: KeyboardEvent): void {
        if (event.key === "Escape" && this.marked) {
            this.unmark();
            return;
        }
        super.handleKeyDownEvent(event);
    }

    handleIncomingCommandMessage(editMapCommandMessage: EditMapCommandMessage): Promise<void> {
        return Promise.resolve(undefined);
    }

    protected bindEventHandlers(): void {
        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.pointerDownEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.pointerUpEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_OVER, this.pointerHoverEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_OUT, this.pointerOutEventHandler);
    }

    protected unbindEventHandlers(): void {
        this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.pointerDownEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.pointerUpEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_OVER, this.pointerHoverEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_OUT, this.pointerOutEventHandler);
    }

    private createAreaPreviews(): AreaPreview[] {
        this.areaPreviews = [];
        const areaConfigs = this.scene.getGameMapFrontWrapper().getAreas();

        if (areaConfigs) {
            for (const config of Array.from(areaConfigs.values())) {
                this.createAreaPreview(config);
            }
        }
        this.setAreaPreviewsVisibility(false);
        return this.areaPreviews;
    }

    private createAreaPreview(areaConfig: AreaData): AreaPreview {
        // For trash tool, area previews must override depth to be always on top. The area previews has opacity that permits to see underneath.
        const areaPreview = new AreaPreview(this.scene, structuredClone(areaConfig), true, undefined, this.ctrlKey);
        this.bindAreaPreviewEventHandlers(areaPreview);
        this.areaPreviews.push(areaPreview);
        return areaPreview;
    }

    private updateAreaPreviews(): void {
        const areaConfigs = this.scene.getGameMapFrontWrapper().getAreas();

        // find previews of areas that exist no longer
        const areaPreviewsToDelete: string[] = [];
        for (const preview of this.areaPreviews) {
            if (!areaConfigs?.has(preview.getId())) {
                areaPreviewsToDelete.push(preview.getId());
            }
        }
        // destroy them
        for (const id of areaPreviewsToDelete) {
            const index = this.areaPreviews.findIndex((preview) => preview.getId() === id);
            if (index !== -1) {
                this.areaPreviews.splice(index, 1)[0]?.destroy();
            }
        }

        // create previews for new areas that were created during our absence in editor mode
        if (areaConfigs) {
            for (const config of Array.from(areaConfigs.values())) {
                const areaPreview = this.areaPreviews.find((areaPreview) => areaPreview.getId() === config.id);
                if (areaPreview) {
                    areaPreview.updatePreview(config);
                } else {
                    this.createAreaPreview(config);
                }
            }
        }
    }

    private setAreaPreviewsVisibility(visible: boolean): void {
        // NOTE: I would really like to use Phaser Layers here but it seems that there's a problem with Areas still being
        //       interactive when we hide whole Layer and thus forEach is needed.
        this.areaPreviews.forEach((area) => area.setVisible(visible));
    }

    private bindAreaPreviewEventHandlers(areaPreview: AreaPreview): void {
        areaPreview.on(AreaPreviewEvent.Delete, () =>
            this.areaEditorTool.handleDeleteAreaFrontCommandExecution(areaPreview.getAreaData().id, this)
        );
    }

    private deleteAreaPreview(id: string): boolean {
        const index = this.areaPreviews.findIndex((preview) => preview.getAreaData().id === id);
        if (index !== -1) {
            this.areaPreviews.splice(index, 1)[0].destroy();
            return true;
        }
        return false;
    }

    private pointerDownEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
        if (!this.active) {
            return;
        }
        this.pressed = this.removableUnder(gameObjects);
    };

    private pointerUpEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
        if (!this.active) {
            return;
        }
        const pressed = this.pressed;
        this.pressed = undefined;
        // A drag that moved the map is not a tap on what it ended over.
        if (this.mapEditorModeManager.isDraggingToLookAround) {
            return;
        }
        // A press on one item released over another is a drag too (the map does not pan from an item): it removes
        // nothing. Only a press and a release on the same item is a click or a tap on it.
        const under = this.removableUnder(gameObjects);
        const target = under === pressed ? under : undefined;
        if (pointer.wasTouch) {
            // A finger cannot hover: the first tap marks, the second tap removes, a tap elsewhere keeps.
            if (target && target === this.marked) {
                this.remove(target);
                return;
            }
            this.mark(target);
            return;
        }
        if (target) {
            this.remove(target);
        }
    };

    private pointerHoverEventHandler = (
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ) => {
        if (!this.active) {
            return;
        }
        const target = this.removableUnder(gameObjects);
        if (target instanceof AreaPreview && target !== this.marked) {
            target.changeColor(0xff0000);
            this.scene.markDirty();
        }
        if (!pointer.wasTouch) {
            this.hovered = target;
            this.publishMark();
        }
    };

    private pointerOutEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
        if (!this.active) {
            return;
        }
        const target = this.removableUnder(gameObjects);
        if (target instanceof AreaPreview && target !== this.marked) {
            target.resetColor();
            this.scene.markDirty();
        }
        if (this.hovered && (target === undefined || target === this.hovered)) {
            this.hovered = undefined;
            this.publishMark();
        }
    };

    /** The object the pointer is on, if the user may remove it, else the area under it. */
    private removableUnder(gameObjects: Phaser.GameObjects.GameObject[]): Entity | AreaPreview | undefined {
        const firstGameObject = gameObjects[0];
        if (firstGameObject instanceof Entity) {
            return this.isAllowedToRemoveGameObject(firstGameObject) ? firstGameObject : undefined;
        }
        const areaEditorToolObjects = this.getAreaEditorToolObjectsFromGameObjects(gameObjects);
        if (areaEditorToolObjects.length === 1 && this.isAreaPreview(areaEditorToolObjects[0])) {
            return areaEditorToolObjects[0];
        }
        return undefined;
    }

    private mark(target: Entity | AreaPreview | undefined): void {
        if (target === this.marked) return;
        this.unmark();
        if (!target) return;
        this.marked = target;
        if (target instanceof Entity) {
            target.setEditColor(MARK_COLOR);
        } else {
            target.changeColor(MARK_COLOR);
        }
        this.scene.markDirty();
        this.publishMark();
    }

    private unmark(): void {
        const marked = this.marked;
        this.marked = undefined;
        if (marked?.scene) {
            if (marked instanceof Entity) {
                marked.removeEditColor();
            } else {
                marked.resetColor();
            }
            this.scene.markDirty();
        }
        this.publishMark();
    }

    private remove(target: Entity | AreaPreview): void {
        const name = this.nameOf(target);
        if (this.marked === target) this.marked = undefined;
        if (this.hovered === target) this.hovered = undefined;
        target.delete();
        // An area's toast comes from the area tool, once the area really goes (a personal one with objects asks first).
        if (target instanceof Entity) showUndoToast(get(LL).mapEditor.edit.deleteTool.removed({ name }));
        this.publishMark();
    }

    private nameOf(target: Entity | AreaPreview): string {
        if (target instanceof Entity) {
            const data = target.getEntityData();
            return data.name || target.getPrefab().name || get(LL).mapEditor.edit.tools.objects();
        }
        return target.getAreaData().name || get(LL).mapEditor.edit.deleteTool.area();
    }

    /** Where the marked (or, with a mouse, the hovered) item is on screen, for the box, the chip and the hint. */
    private publishMark(): void {
        const target = this.marked ?? this.hovered;
        if (!target || !target.scene) {
            if (this.lastMark) {
                this.lastMark = undefined;
                this.lastMarkTarget = undefined;
                editDeleteMarkStore.set(undefined);
            }
            return;
        }
        const topLeft =
            target instanceof Entity
                ? target.getTopLeft()
                : { x: target.x - target.displayWidth * 0.5, y: target.y - target.displayHeight * 0.5 };
        const next: DeleteMark = {
            ...screenSpace(this.scene).rect(topLeft.x ?? 0, topLeft.y ?? 0, target.displayWidth, target.displayHeight),
            tapped: target === this.marked,
            remove: () => this.remove(target),
        };
        const last = this.lastMark;
        if (
            last &&
            this.lastMarkTarget === target &&
            last.x === next.x &&
            last.y === next.y &&
            last.width === next.width &&
            last.height === next.height &&
            last.tapped === next.tapped
        ) {
            return;
        }
        this.lastMark = next;
        this.lastMarkTarget = target;
        editDeleteMarkStore.set(next);
    }

    private isAreaPreview(obj: Phaser.GameObjects.GameObject): obj is AreaPreview {
        return obj instanceof AreaPreview;
    }

    private isSizeAlteringSquare(obj: Phaser.GameObjects.GameObject): obj is SizeAlteringSquare {
        return obj instanceof SizeAlteringSquare;
    }

    private getAreaEditorToolObjectsFromGameObjects(
        gameObjects: Phaser.GameObjects.GameObject[]
    ): (AreaPreview | SizeAlteringSquare)[] {
        const areaPreviews = gameObjects.filter((obj) => this.isAreaPreview(obj));
        const sizeAlteringSquares = gameObjects.filter((obj) => this.isSizeAlteringSquare(obj));
        return [...areaPreviews, ...sizeAlteringSquares];
    }

    private getAreaPreviewVisibileFromUserPermissions(): boolean {
        if (get(userIsAdminStore) || get(userIsEditorStore)) {
            return true;
        }
        return false;
    }

    private isAllowedToRemoveGameObject(gameObject: Entity) {
        return gameObject.canEdit;
    }
}
