import type { AreaData, AtLeast } from "@workadventure/map-editor";
import type { EditMapCommandMessage } from "@workadventure/messages";
import type { Unsubscriber } from "svelte/store";
import { get } from "svelte/store";
import { v4 as uuid } from "uuid";
import { openModal } from "svelte-modals";
import type { MapEditorAreaToolMode } from "../../../../Stores/MapEditorStore";
import {
    mapEditorAreaModeStore,
    mapEditorSelectedAreaPreviewStore,
    mapEditorVisibilityStore,
} from "../../../../Stores/MapEditorStore";
import {
    editAreaDraftStore,
    editAreaDrawArmedStore,
    editAreaGhostStore,
    editAreaSketchStore,
    showUndoToast,
} from "../../../../Stores/EditModeStore";
import { mobileLayoutStore } from "../../../../Stores/MobileLayoutStore";
import { AreaPreview, AreaPreviewEvent } from "../../../Components/MapEditor/AreaPreview";
import { SizeAlteringSquare } from "../../../Components/MapEditor/SizeAlteringSquare";
import type { CopyAreaEventData } from "../../GameMap/EntitiesManager";
import type { GameMapFrontWrapper } from "../../GameMap/GameMapFrontWrapper";
import type { GameScene } from "../../GameScene";
import { CreateAreaFrontCommand } from "../Commands/Area/CreateAreaFrontCommand";
import { DeleteAreaFrontCommand } from "../Commands/Area/DeleteAreaFrontCommand";
import { UpdateAreaFrontCommand } from "../Commands/Area/UpdateAreaFrontCommand";
import type { MapEditorModeManager } from "../MapEditorModeManager";
import type { Entity } from "../../../ECS/Entity";
import { DeleteEntityFrontCommand } from "../Commands/Entity/DeleteEntityFrontCommand";
import ActionPopupOnPersonalAreaWithEntities from "../../../../Components/MapEditor/ActionPopupOnPersonalAreaWithEntities.svelte";
import { SpeechDomElement } from "../../../Entity/SpeechDomElement";
import { LL } from "../../../../../i18n/i18n-svelte";
import { MapEditorTool } from "./MapEditorTool";
import type { TrashEditorTool } from "./TrashEditorTool";

export class AreaEditorTool extends MapEditorTool {
    private scene: GameScene;
    private mapEditorModeManager: MapEditorModeManager;

    /**
     * Visual representations of map Areas objects
     */
    private areaPreviews: AreaPreview[] = [];
    private currentlySelectedPreview: AreaPreview | undefined;

    private active: boolean;

    private drawingNewArea: boolean;
    private drawinNewAreaStartPos?: { x: number; y: number };
    /** The glide of the map to an area picked in the list. */
    private glide?: Phaser.Tweens.Tween;

    private draggingdArea: boolean;
    private wasAreaMoved: boolean;
    /** Where the pressed area was: its dashed line shows once the pointer moves, so a tap shows none. */
    private ghostOnMove?: { x: number; y: number; width: number; height: number };

    private shiftKey?: Phaser.Input.Keyboard.Key;
    private ctrlKey?: Phaser.Input.Keyboard.Key;

    private tooltip?: SpeechDomElement;
    private toolTipAlreadyPlayed: boolean = false;

    private selectedAreaPreviewStoreSubscriber!: Unsubscriber;

    private pointerMoveEventHandler!: (pointer: Phaser.Input.Pointer) => void;
    private pointerUpEventHandler!: (
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ) => void;

    private pointerDownEventHandler!: (
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ) => void;

    constructor(mapEditorModeManager: MapEditorModeManager) {
        super();
        this.mapEditorModeManager = mapEditorModeManager;
        this.scene = this.mapEditorModeManager.getScene();

        this.shiftKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
        this.ctrlKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

        this.active = false;
        this.drawingNewArea = false;

        this.draggingdArea = false;
        this.wasAreaMoved = false;

        this.drawinNewAreaStartPos = undefined;

        this.subscribeToStores();
    }

    public update(time: number, dt: number): void {
        this.areaPreviews.forEach((preview) => preview.update(time, dt));
    }

    public clear(): void {
        this.active = false;
        this.drawingNewArea = false;
        this.draggingdArea = false;
        this.wasAreaMoved = false;
        this.drawinNewAreaStartPos = undefined;
        mapEditorSelectedAreaPreviewStore.set(undefined);
        // A "New area" box left on the map goes with the tool: the next time the tool opens, it starts clean.
        editAreaDraftStore.set(undefined);
        editAreaDrawArmedStore.set(false);
        editAreaSketchStore.set(undefined);
        this.ghostOnMove = undefined;
        editAreaGhostStore.set(undefined);
        this.glide?.stop();
        this.glide = undefined;
        this.setAreaPreviewsVisibility(false);
        this.scene.input.setDefaultCursor("auto");
        this.unbindEventHandlers();
        this.scene.markDirty();
    }

    public activate(): void {
        this.areaPreviews = this.createAreaPreviews();
        this.active = true;
        this.scene.input.setTopOnly(false);
        this.updateAreaPreviews();
        this.setAreaPreviewsVisibility(true);
        this.bindEventHandlers();
        this.changeAreaMode("ADD");
        this.makeAllEntitiesInteractive();
        this.scene.markDirty();
    }

    public destroy(): void {
        this.areaPreviews.forEach((preview) => preview.destroy());
        this.selectedAreaPreviewStoreSubscriber();
        this.unbindEventHandlers();
        this.scene.input.setDefaultCursor("auto");
    }

    public async handleIncomingCommandMessage(editMapCommandMessage: EditMapCommandMessage): Promise<void> {
        const commandId = editMapCommandMessage.id;
        switch (editMapCommandMessage.editMapMessage?.message?.$case) {
            case "modifyAreaMessage": {
                const data = editMapCommandMessage.editMapMessage?.message.modifyAreaMessage;
                // execute command locally
                await this.mapEditorModeManager.executeLocalCommand(
                    new UpdateAreaFrontCommand(
                        this.scene.getGameMap(),
                        {
                            ...data,
                            properties: data.modifyProperties ? data.properties : undefined,
                        },
                        commandId,
                        undefined,
                        this,
                        this.scene.getGameMapFrontWrapper()
                    )
                );
                break;
            }
            case "createAreaMessage": {
                const data = editMapCommandMessage.editMapMessage?.message.createAreaMessage;
                const config: AreaData = {
                    ...data,
                    visible: true,
                };
                // execute command locally
                await this.mapEditorModeManager.executeLocalCommand(
                    new CreateAreaFrontCommand(
                        this.scene.getGameMap(),
                        config,
                        commandId,
                        this,
                        false,
                        this.scene.getGameMapFrontWrapper()
                    )
                );
                break;
            }
            case "deleteAreaMessage": {
                const data = editMapCommandMessage.editMapMessage?.message.deleteAreaMessage;
                // execute command locally
                await this.mapEditorModeManager.executeLocalCommand(
                    new DeleteAreaFrontCommand(
                        this.scene.getGameMap(),
                        data.id,
                        commandId,
                        this,
                        this.scene.getGameMapFrontWrapper()
                    )
                );
                break;
            }
        }
    }

    /**
     * Removes the area and shows the "removed · Undo" toast, but only once it really goes: a personal area with
     * objects inside asks first, and a cancelled ask removes nothing and shows nothing.
     */
    /** @param onRemoved Runs once the area is really gone, so a removal that asks first and is cancelled leaves everything as it was. */
    public handleDeleteAreaFrontCommandExecution(
        areaId: string,
        editorTool?: AreaEditorTool | TrashEditorTool,
        onRemoved?: () => void
    ): void {
        const name = this.getAreaPreviewConfig(areaId)?.name || get(LL).mapEditor.edit.deleteTool.area();
        const removed = () => {
            showUndoToast(get(LL).mapEditor.edit.deleteTool.removed({ name }));
            onRemoved?.();
        };
        const isPersonalArea = this.getIsPersonalArea(areaId);
        const deleteAreaCommand = new DeleteAreaFrontCommand(
            this.scene.getGameMap(),
            areaId,
            undefined,
            editorTool ?? this,
            this.scene.getGameMapFrontWrapper()
        );
        if (isPersonalArea) {
            const entitiesInsideArea = this.getEntitiesInsideArea(areaId);
            if (entitiesInsideArea.size > 0) {
                openModal(ActionPopupOnPersonalAreaWithEntities, {
                    onDeleteEntities: () =>
                        this.executeDeletePersonalAreaWithEntities(areaId, deleteAreaCommand, removed, true),
                    onKeepEntities: () =>
                        this.executeDeletePersonalAreaWithEntities(areaId, deleteAreaCommand, removed),
                    onCancel: () => {},
                });
                return;
            }
        }
        // The toast follows the command, so a removal that did not go through shows no toast.
        this.mapEditorModeManager
            .executeCommand(deleteAreaCommand)
            .then(removed)
            .catch((error) => console.error(error));
    }

    private getIsPersonalArea(areaId: string): boolean {
        return !!this.scene.getGameMap().getGameMapAreas()?.isPersonalArea(areaId);
    }

    private getEntitiesInsideArea(areaId: string): Map<string, Entity> {
        const entitiesManager = this.scene.getGameMapFrontWrapper().getEntitiesManager();
        return entitiesManager.getEntitiesInsideArea(areaId);
    }

    public subscribeToGameMapFrontWrapperEvents(gameMapFrontWrapper: GameMapFrontWrapper): void {}

    public getAreaPreviewConfig(id: string): AreaData | undefined {
        return this.getAreaPreview(id)?.getAreaData();
    }

    public handleKeyDownEvent(event: KeyboardEvent): void {
        switch (event.key.toLowerCase()) {
            case "backspace":
            case "delete": {
                const areaPreview = get(mapEditorSelectedAreaPreviewStore);
                if (!areaPreview) {
                    break;
                }
                this.handleDeleteAreaFrontCommandExecution(areaPreview.getId());
                this.changeAreaMode("ADD");
                break;
            }
            default: {
                break;
            }
        }
    }

    private bindEventHandlers(): void {
        this.pointerMoveEventHandler = (pointer: Phaser.Input.Pointer) => {
            this.handlePointerMoveEvent(pointer);
        };
        this.pointerUpEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
            this.handlePointerUpEvent(pointer, gameObjects);
        };
        this.pointerDownEventHandler = (
            pointer: Phaser.Input.Pointer,
            gameObjects: Phaser.GameObjects.GameObject[]
        ) => {
            this.handlePointerDownEvent(pointer, gameObjects);
        };

        this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.pointerUpEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.pointerDownEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_OVER, this.pointerHoverEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_OUT, this.pointerOutEventHandler);

        this.shiftKey?.on(Phaser.Input.Keyboard.Events.DOWN, () => {
            if (this.drawingNewArea && this.drawinNewAreaStartPos) {
                this.drawNewArea(this.scene.input.activePointer);
            }
        });

        this.shiftKey?.on(Phaser.Input.Keyboard.Events.UP, () => {
            if (this.drawingNewArea && this.drawinNewAreaStartPos) {
                this.drawNewArea(this.scene.input.activePointer);
            }
        });
        this.ctrlKey?.on(Phaser.Input.Keyboard.Events.DOWN, () => {
            this.scene.input.setDefaultCursor("crosshair");
        });
        this.ctrlKey?.on(Phaser.Input.Keyboard.Events.UP, () => {
            this.scene.input.setDefaultCursor("grab");
        });
    }

    private unbindEventHandlers(): void {
        this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.pointerUpEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.pointerDownEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_OVER, this.pointerHoverEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_OUT, this.pointerOutEventHandler);
    }

    private pointerHoverEventHandler = (
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ) => {
        if (!this.active) {
            return;
        }
        const areaEditorToolObjects = this.getAreaEditorToolObjectsFromGameObjects(gameObjects);
        if (areaEditorToolObjects.length === 1) {
            if (this.isAreaPreview(areaEditorToolObjects[0])) {
                this.scene.input.setDefaultCursor("grab");
            }
        }
    };

    private pointerOutEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) => {
        if (!this.active) {
            return;
        }
        const areaEditorToolObjects = this.getAreaEditorToolObjectsFromGameObjects(gameObjects);
        if (areaEditorToolObjects.length === 1) {
            if (this.isAreaPreview(areaEditorToolObjects[0])) {
                this.scene.input.setDefaultCursor("crosshair");
            }
        }
    };

    private handlePointerDownEvent(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
        const areaEditorToolObjects = this.getAreaEditorToolObjectsFromGameObjects(gameObjects);
        if (pointer.rightButtonDown()) {
            return;
        }
        const mode = get(mapEditorAreaModeStore);

        // After "New area", a drag draws the new area's box wherever it starts, over other areas too.
        if (get(editAreaDrawArmedStore)) {
            this.draggingdArea = false;
            this.wasAreaMoved = false;
            this.drawingNewArea = true;
            this.drawinNewAreaStartPos = { x: pointer.worldX, y: pointer.worldY };
            return;
        }

        if (areaEditorToolObjects.length === 0) {
            this.draggingdArea = false;
            this.wasAreaMoved = false;

            // A finger on the empty map pans it; it draws only after "New area".
            if (pointer.wasTouch) {
                return;
            }
            if (mode === "ADD") {
                this.drawingNewArea = true;
                this.drawinNewAreaStartPos = { x: pointer.worldX, y: pointer.worldY };
                return;
            }
            if (mode === "EDIT") {
                this.changeAreaMode("ADD");
                this.drawingNewArea = true;
                this.drawinNewAreaStartPos = { x: pointer.worldX, y: pointer.worldY };
                return;
            }
            return;
        }

        if (areaEditorToolObjects.length === 1) {
            if (this.isAreaPreview(areaEditorToolObjects[0])) {
                this.changeAreaMode("EDIT", areaEditorToolObjects[0]);
                this.tuckSheetOnPhone(areaEditorToolObjects[0]);
                this.scene.input.setDefaultCursor("grabbing");
                this.wasAreaMoved = true;
            }
        }
    }

    private handlePointerUpEvent(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
        // Improve select mutliple zone and add tooltips to the areas to say "You can click again to select another zone"
        if (this.active && gameObjects.length > 1 && this.toolTipAlreadyPlayed == false) {
            if (this.tooltip == undefined)
                this.playTooltip(
                    get(LL).mapEditor.areaEditor.clickAgainToSelectAnotherZone(),
                    pointer.worldX,
                    pointer.worldY
                );
            else this.destroyTooltip();
        }

        // The dashed line of where a moved or resized area was goes when the pointer lets go, wherever it is.
        this.ghostOnMove = undefined;
        editAreaGhostStore.set(undefined);

        if (get(editAreaDrawArmedStore)) {
            // A box drawn from inside an area also started a drag of that area: it ends here too.
            this.draggingdArea = false;
            if (this.drawinNewAreaStartPos) {
                const drawingData = this.getNewAreaDrawingData(pointer);
                // Too small to be a drag (a tap): still waiting for the drag that draws the box.
                if (drawingData.width >= 10 && drawingData.height >= 10) {
                    editAreaDraftStore.set(drawingData);
                    editAreaDrawArmedStore.set(false);
                }
            }
            this.drawinNewAreaStartPos = undefined;
            this.drawingNewArea = false;
            editAreaSketchStore.set(undefined);
            this.scene.markDirty();
            return;
        }

        const mode = get(mapEditorAreaModeStore);
        const sortedAreaPreviews = gameObjects
            .filter((obj) => this.isAreaPreview(obj))
            .sort((a1, a2) => {
                return a1.getSize() - a2.getSize();
            });

        if (mode === "ADD") {
            if (this.drawinNewAreaStartPos) {
                const drawingData = this.getNewAreaDrawingData(pointer);

                if (drawingData.width >= 10 && drawingData.height >= 10) {
                    this.createNewArea(drawingData.x, drawingData.y, drawingData.width, drawingData.height);
                }
                this.drawinNewAreaStartPos = undefined;
                this.drawingNewArea = false;
                editAreaSketchStore.set(undefined);
                this.scene.markDirty();
                return;
            }
            if (
                pointer.wasTouch &&
                (sortedAreaPreviews.length === 0 || this.mapEditorModeManager.isDraggingToLookAround)
            ) {
                // A tap on the empty map has nothing to select, and a pan selects nothing wherever it ends.
                return;
            }
            this.changeAreaMode("EDIT", sortedAreaPreviews[0]);
            this.tuckSheetOnPhone(sortedAreaPreviews[0]);
        } else if (mode === "EDIT") {
            const currentlySelectedArea = get(mapEditorSelectedAreaPreviewStore);

            for (const obj of gameObjects) {
                if (this.isSizeAlteringSquare(obj)) {
                    this.draggingdArea = false;
                    this.wasAreaMoved = false;
                    return;
                }
            }

            if (pointer.wasTouch && this.mapEditorModeManager.isDraggingToLookAround) {
                // A finger pan keeps the selected area wherever it ends; a tap on the empty map still deselects it,
                // as a click does, and a tap on an area selects that area.
                return;
            }

            if (currentlySelectedArea) {
                if (!sortedAreaPreviews.includes(currentlySelectedArea)) {
                    if (document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                    }
                    mapEditorSelectedAreaPreviewStore.set(sortedAreaPreviews[0]);
                    this.tuckSheetOnPhone(sortedAreaPreviews[0]);
                } else {
                    if (this.wasAreaMoved) {
                        this.draggingdArea = false;
                        this.wasAreaMoved = false;
                        this.scene.input.setDefaultCursor("grab");
                    } else {
                        const nextAreaIndex =
                            (sortedAreaPreviews.indexOf(currentlySelectedArea) + 1) % sortedAreaPreviews.length;
                        if (document.activeElement instanceof HTMLElement) {
                            document.activeElement.blur();
                        }
                        mapEditorSelectedAreaPreviewStore.set(sortedAreaPreviews[nextAreaIndex]);
                    }
                }
                // can happen after we delete an Area
            } else {
                if (sortedAreaPreviews.length > 0) {
                    if (document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                    }
                    mapEditorSelectedAreaPreviewStore.set(sortedAreaPreviews[0]);
                }
            }
        }
    }

    private handlePointerMoveEvent(pointer: Phaser.Input.Pointer): void {
        if (this.drawingNewArea && this.drawinNewAreaStartPos) {
            this.drawNewArea(pointer);
        }
        if (this.draggingdArea) {
            this.wasAreaMoved = true;
            if (this.ghostOnMove) {
                editAreaGhostStore.set(this.ghostOnMove);
                this.ghostOnMove = undefined;
            }
        }
    }

    /** The box being drawn is drawn by the page, as the frame every area has (AreaFrames.svelte). */
    private drawNewArea(pointer: Phaser.Input.Pointer): void {
        editAreaSketchStore.set(this.getNewAreaDrawingData(pointer));
        this.scene.markDirty();
    }

    /**
     * On a phone, an area picked on the map puts the Areas sheet away, so the area and its dots are in view; a tap that
     * picks nothing (beside the area) brings the sheet back.
     */
    private tuckSheetOnPhone(picked: AreaPreview | undefined): void {
        if (get(mobileLayoutStore)) mapEditorVisibilityStore.set(picked === undefined);
    }

    private getNewAreaDrawingData(pointer: Phaser.Input.Pointer): {
        x: number;
        y: number;
        width: number;
        height: number;
    } {
        if (!this.drawinNewAreaStartPos) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }
        const width = Math.abs(pointer.worldX - this.drawinNewAreaStartPos.x);
        const height = Math.abs(pointer.worldY - this.drawinNewAreaStartPos.y);
        const x = Math.min(this.drawinNewAreaStartPos.x, pointer.worldX);
        const y = Math.min(this.drawinNewAreaStartPos.y, pointer.worldY);
        if (this.shiftKey?.isDown) {
            return {
                x: Math.floor(x / 32) * 32,
                y: Math.floor(y / 32) * 32,
                width: Math.floor(width / 32) * 32 + 32,
                height: Math.floor(height / 32) * 32 + 32,
            };
        }
        return {
            x,
            y,
            width,
            height,
        };
    }

    private getAreaEditorToolObjectsFromGameObjects(
        gameObjects: Phaser.GameObjects.GameObject[]
    ): (AreaPreview | SizeAlteringSquare)[] {
        const areaPreviews = gameObjects.filter((obj) => this.isAreaPreview(obj));
        const sizeAlteringSquares = gameObjects.filter((obj) => this.isSizeAlteringSquare(obj));
        return [...areaPreviews, ...sizeAlteringSquares] as (AreaPreview | SizeAlteringSquare)[];
    }

    private changeAreaMode(mode: MapEditorAreaToolMode, areaPreview?: AreaPreview): void {
        mapEditorAreaModeStore.set(mode);
        this.scene.input.setDefaultCursor("crosshair");
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        mapEditorSelectedAreaPreviewStore.set(areaPreview);
    }

    public handleAreaDeletion(id: string, areaData: AreaData | undefined): void {
        this.scene.getGameMapFrontWrapper().listenAreaDeletion(areaData);

        if (!this.active) {
            return;
        }

        this.deleteAreaPreview(id);
        this.scene.markDirty();
        mapEditorSelectedAreaPreviewStore.set(undefined);
        this.tuckSheetOnPhone(undefined);
    }

    public handleAreaCreation(config: AreaData, localCommand: boolean): void {
        this.scene.getGameMapFrontWrapper().listenAreaCreation(config);

        if (!this.active) {
            return;
        }

        const areaPreview = this.createAreaPreview(config);
        this.scene.markDirty();

        if (localCommand) {
            this.changeAreaMode("EDIT", areaPreview);
        }
    }

    public handleAreaUpdate(oldConfig: AtLeast<AreaData, "id">, newConfig: AtLeast<AreaData, "id">): void {
        this.scene.getGameMapFrontWrapper().listenAreaChanges(oldConfig, newConfig);

        if (!this.active) {
            return;
        }

        const area = this.areaPreviews.find((area) => area.getAreaData().id === newConfig.id);

        if (area) {
            area.updatePreview(newConfig);
            // The panel re-reads the selected area; a change to another area (a save that lands after you moved on,
            // or someone else's edit) must not open that area instead.
            if (get(mapEditorSelectedAreaPreviewStore) === area) {
                mapEditorSelectedAreaPreviewStore.set(area);
            }
        }

        this.scene.markDirty();
    }

    private getAreaPreview(id: string): AreaPreview | undefined {
        return this.areaPreviews.find((area) => area.getId() === id);
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
        const areaPreview = new AreaPreview(this.scene, structuredClone(areaConfig), true, this.shiftKey, this.ctrlKey);
        areaPreview.useMapFrame();
        this.bindAreaPreviewEventHandlers(areaPreview);
        this.areaPreviews.push(areaPreview);
        return areaPreview;
    }

    private copyArea(data: CopyAreaEventData): void {
        const id = uuid();
        this.mapEditorModeManager
            .executeCommand(
                new CreateAreaFrontCommand(
                    this.scene.getGameMap(),
                    {
                        id,
                        name: data.name,
                        visible: true,
                        properties: data.properties ?? [],
                        width: data.width,
                        height: data.height,
                        x: data.position.x,
                        y: data.position.y,
                    },
                    undefined,
                    this,
                    true,
                    this.scene.getGameMapFrontWrapper()
                )
            )
            .catch((e) => console.error(e));
    }

    /** Open an area's settings from the list in the panel. */
    public selectArea(id: string): void {
        const preview = this.getAreaPreview(id);
        if (!preview) return;
        this.changeAreaMode("EDIT", preview);
    }

    /** Back to the list: no area selected. */
    public deselectArea(): void {
        // "New area" comes through here: a glide to an area picked a moment ago stops, so the map holds still to draw on.
        this.glide?.stop();
        this.glide = undefined;
        this.changeAreaMode("ADD");
    }

    /** Create an area from the box drawn in the "New area" overlay (phones and computers alike). */
    public createNewAreaFromDraft(draft: { x: number; y: number; width: number; height: number }): void {
        if (draft.width < 10 || draft.height < 10) return;
        this.createNewArea(Math.round(draft.x), Math.round(draft.y), Math.round(draft.width), Math.round(draft.height));
    }

    /** Dragging the empty map moves around unless it is drawing a new area. */
    public canDragToLookAround(pointer: Phaser.Input.Pointer): boolean {
        return pointer.wasTouch && !this.drawingNewArea && !get(editAreaDrawArmedStore);
    }

    /** The areas of the room as the tool shows them, for the page that draws their frames. */
    public getAreaPreviews(): readonly AreaPreview[] {
        return this.active ? this.areaPreviews : [];
    }

    /**
     * An area picked in the list: the map glides to it when it is not already in full view, and it is picked as a
     * tap on it would. The free part of the screen is given by the caller, in screen pixels of the canvas.
     */
    public glideToArea(id: string, free?: { left: number; top: number; right: number; bottom: number }): void {
        const preview = this.getAreaPreview(id);
        if (!preview) return;
        // Picking an area from the list ends "New area", or the next drag on it would also draw a box.
        editAreaDrawArmedStore.set(false);
        this.changeAreaMode("EDIT", preview);
        if (get(mobileLayoutStore)) mapEditorVisibilityStore.set(false);
        const camera = this.scene.cameras.main;
        const view = camera.worldView;
        if (view.width === 0) return;
        const scale = this.scene.game.canvas.getBoundingClientRect().width / view.width;
        const data = preview.getAreaData();
        const box = free ?? { left: 0, top: 0, right: view.width * scale, bottom: view.height * scale };
        const inView =
            data.x >= view.x + box.left / scale &&
            data.y >= view.y + box.top / scale &&
            data.x + data.width <= view.x + box.right / scale &&
            data.y + data.height <= view.y + box.bottom / scale;
        if (inView) return;
        // From where the middle of the free part is now, to the middle of the area.
        const fromX = view.x + (box.left + box.right) / 2 / scale;
        const fromY = view.y + (box.top + box.bottom) / 2 / scale;
        const dx = data.x + data.width / 2 - fromX;
        const dy = data.y + data.height / 2 - fromY;
        const cameraManager = this.scene.getCameraManager();
        this.glide?.stop();
        let done = 0;
        this.glide = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 450,
            ease: "Sine.easeOut",
            onUpdate: (tween) => {
                const progress = tween.getValue() ?? 0;
                // The same moves as a drag, so the camera lets go of the player the way a drag makes it.
                cameraManager.dragCamera(dx * (progress - done), dy * (progress - done));
                done = progress;
            },
        });
    }

    private createNewArea(x: number, y: number, width: number, height: number): void {
        const id = uuid();
        this.mapEditorModeManager
            .executeCommand(
                new CreateAreaFrontCommand(
                    this.scene.getGameMap(),
                    {
                        id,
                        name: "",
                        visible: true,
                        // The description comes with the area, so that selecting it adds nothing to the undo history.
                        properties: [
                            { id: uuid(), type: "areaDescriptionProperties", description: "", searchable: false },
                        ],
                        width,
                        height,
                        x,
                        y,
                    },
                    undefined,
                    this,
                    true,
                    this.scene.getGameMapFrontWrapper()
                )
            )
            .catch((e) => console.error(e));
    }

    private deleteAreaPreview(id: string): boolean {
        const index = this.areaPreviews.findIndex((preview) => preview.getAreaData().id === id);
        if (index !== -1) {
            this.areaPreviews.splice(index, 1)[0].destroy();
            return true;
        }
        return false;
    }

    private subscribeToStores(): void {
        this.selectedAreaPreviewStoreSubscriber = mapEditorSelectedAreaPreviewStore.subscribe(
            (preview: AreaPreview | undefined) => {
                this.currentlySelectedPreview?.select(false);
                this.currentlySelectedPreview = preview;
                if (this.currentlySelectedPreview) {
                    this.currentlySelectedPreview?.select(true);
                }
                this.scene.markDirty();
            }
        );
    }

    private executeDeletePersonalAreaWithEntities(
        areaId: string,
        deleteAreaCommand: DeleteAreaFrontCommand,
        onRemoved: () => void,
        removeEntities?: boolean
    ): void {
        if (removeEntities) {
            this.removeAreaEntities(areaId);
        }
        this.mapEditorModeManager
            .executeCommand(deleteAreaCommand)
            .then(onRemoved)
            .catch((error) => console.error(error));
    }

    private executeUpdateAreaFrontCommand(
        newData: AtLeast<AreaData, "id">,
        oldData: AtLeast<AreaData, "id"> | undefined,
        removeEntities?: boolean
    ): void {
        const gameMap = this.scene.getGameMap();
        if (removeEntities) {
            this.removeAreaEntities(newData.id);
        }
        this.mapEditorModeManager
            .executeCommand(
                new UpdateAreaFrontCommand(
                    gameMap,
                    newData,
                    undefined,
                    oldData,
                    this,
                    this.scene.getGameMapFrontWrapper()
                )
            )
            .catch((error) => console.error(error));
    }

    private removeAreaEntities(areaId: string): void {
        const gameMap = this.scene.getGameMap();
        const entitiesManager = this.scene.getGameMapFrontWrapper().getEntitiesManager();
        const entitiesInsideArea = this.getEntitiesInsideArea(areaId);
        entitiesInsideArea.forEach((_, entityId) => {
            this.mapEditorModeManager
                .executeCommand(new DeleteEntityFrontCommand(gameMap, entityId, undefined, entitiesManager))
                .catch((error) => console.error(error));
        });
    }

    private bindAreaPreviewEventHandlers(areaPreview: AreaPreview): void {
        areaPreview.on(AreaPreviewEvent.DragStart, () => {
            this.draggingdArea = true;
            // Only the picked area moves or resizes: its old place shows as a faint dashed line meanwhile.
            if (areaPreview.isSelected()) {
                const { x, y, width, height } = areaPreview.getAreaData();
                this.ghostOnMove = { x, y, width, height };
            }
            areaPreview.destroyText();
        });
        areaPreview.on(AreaPreviewEvent.Released, () => {
            this.draggingdArea = false;
            this.ghostOnMove = undefined;
            editAreaGhostStore.set(undefined);
        });
        areaPreview.on(AreaPreviewEvent.Copied, (data: CopyAreaEventData) => {
            this.copyArea(data);
        });
        areaPreview.on(
            AreaPreviewEvent.Updated,
            (
                newData: AtLeast<AreaData, "id">,
                oldData: AtLeast<AreaData, "id"> | undefined,
                removeAreaEntities: boolean | undefined
            ) => {
                this.executeUpdateAreaFrontCommand(newData, oldData, removeAreaEntities);
                areaPreview.playText();
            }
        );
        areaPreview.on(AreaPreviewEvent.Delete, () => {
            this.handleDeleteAreaFrontCommandExecution(areaPreview.getId());
        });
        areaPreview.on(AreaPreviewEvent.UpdateVisibility, (visibility: boolean) => {
            if (!visibility) {
                this.ghostOnMove = undefined;
                editAreaGhostStore.set(undefined);
                areaPreview.destroyText();
            }
        });
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

    private isAreaPreview(obj: Phaser.GameObjects.GameObject): obj is AreaPreview {
        return obj instanceof AreaPreview;
    }

    private isSizeAlteringSquare(obj: Phaser.GameObjects.GameObject): obj is SizeAlteringSquare {
        return obj instanceof SizeAlteringSquare;
    }

    private makeAllEntitiesInteractive() {
        const entitiesManager = this.scene.getGameMapFrontWrapper().getEntitiesManager();
        entitiesManager.makeAllEntitiesInteractive(false);
    }

    // Play text on the Image entity
    private playTooltip(text: string, x: number, y: number): void {
        if (this.toolTipAlreadyPlayed) return;
        setTimeout(() => {
            this.tooltip = new SpeechDomElement("info-tooltip", text, this.scene, x, y - 60, () =>
                this.destroyTooltip()
            );
            this.scene.add.existing(this.tooltip);
            // Need to put the element at the top because
            // if the SpechDomElement is inside of the area, pointer mouse events will not triggered
            this.tooltip.play(x, y - 20, 3000);
        }, 10);
    }

    private destroyTooltip(): void {
        if (this.tooltip == undefined || this.toolTipAlreadyPlayed) return;
        // Check if the tooltip is in the scene
        this.scene.sys.updateList.remove(this.tooltip);
        this.tooltip.destroy();
        this.toolTipAlreadyPlayed = true;
    }
}
