import type { AreaData, EntityData, WAMEntityData } from "@workadventure/map-editor";
import * as Sentry from "@sentry/svelte";
import type { EditMapCommandMessage } from "@workadventure/messages";
import type { Unsubscriber } from "svelte/store";
import { get } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import {
    mapEditorCopiedEntityDataPropertiesStore,
    mapEditorDeleteCustomEntityEventStore,
    mapEditorEntityFileDroppedStore,
    mapEditorEntityModeStore,
    mapEditorEntityUploadEventStore,
    mapEditorModifyCustomEntityEventStore,
    mapEditorSelectedEntityPrefabStore,
    mapEditorSelectedEntityStore,
    mapEditorSelectedToolStore,
    mapEditorVisibilityStore,
} from "../../../../Stores/MapEditorStore";
import { TexturesHelper } from "../../../Helpers/TexturesHelper";
import { CopyEntityEventData, EntitiesManagerEvent } from "../../GameMap/EntitiesManager";
import { CreateEntityFrontCommand } from "../Commands/Entity/CreateEntityFrontCommand";
import { DeleteCustomEntityFrontCommand } from "../Commands/Entity/DeleteCustomEntityFrontCommand";
import { DeleteEntityFrontCommand } from "../Commands/Entity/DeleteEntityFrontCommand";
import { ModifyCustomEntityFrontCommand } from "../Commands/Entity/ModifyCustomEntityFrontCommand";
import { UpdateEntityFrontCommand } from "../Commands/Entity/UpdateEntityFrontCommand";
import { UploadEntityFrontCommand } from "../Commands/Entity/UploadEntityFrontCommand";
import type { MapEditorModeManager } from "../MapEditorModeManager";
import { EditorToolName } from "../MapEditorModeManager";
import { AreaPreview } from "../../../Components/MapEditor/AreaPreview";
import type { Entity } from "../../../ECS/Entity";
import { mapEditorActivated } from "../../../../Stores/MenuStore";
import { editObjectsViewStore, editRecentObjectsStore, editTouchPreviewStore } from "../../../../Stores/EditModeStore";
import { EntityRelatedEditorTool } from "./EntityRelatedEditorTool";

export class EntityEditorTool extends EntityRelatedEditorTool {
    private handleUpdateEntity: (entityData: EntityData) => void;
    private handleCopyEntity: (data: CopyEntityEventData) => void;
    /**
     * Visual representations of map Areas objects
     */
    protected areaPreviews: AreaPreview[] = [];

    protected ctrlKey?: Phaser.Input.Keyboard.Key;
    protected shiftKey?: Phaser.Input.Keyboard.Key;
    protected pointerMoveEventHandler!: (
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ) => void;
    protected pointerDownEventHandler!: (
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ) => void;

    protected mapEditorEntityUploadStoreUnsubscriber: Unsubscriber | undefined;
    protected mapEditorModifyCustomEntityEventStoreUnsubscriber: Unsubscriber | undefined;
    protected mapEditorDeleteCustomEntityEventStoreUnsubscriber: Unsubscriber | undefined;

    constructor(mapEditorModeManager: MapEditorModeManager) {
        super(mapEditorModeManager);
        this.shiftKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
        this.ctrlKey = this.scene.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

        this.handleUpdateEntity = this.updateEntity.bind(this);
        this.handleCopyEntity = this.copyEntity.bind(this);
    }

    public activate(): void {
        super.activate();
        this.createAreaPreviews();
        this.setAreaPreviewsVisibility(true);
        this.subscribeToEntityUpload();
        this.subscribeToModifyCustomEntityEventStore();
        this.subscribeToDeleteCustomEntityEventStore();

        this.bindEventHandlers();
        this.bindEntitiesManagerEventHandlers();
    }

    public update(time: number, dt: number): void {
        super.update(time, dt);
        // The "Tap again to place" pill follows the preview when the map is dragged underneath it.
        if (this.touchPreviewWaiting) {
            this.publishTouchPreview();
        }
        // With a finger, the preview stays hidden until a tap puts it somewhere: it has no pointer to follow.
        if (
            this.entityPrefabPreview?.visible &&
            !this.touchPreviewWaiting &&
            !this.touchDraggingPreview &&
            this.scene.input.activePointer.wasTouch
        ) {
            this.entityPrefabPreview.setVisible(false);
            this.scene.markDirty();
        }
    }

    protected cleanPreview(): void {
        super.cleanPreview();
        this.touchPreviewWaiting = false;
        this.touchDraggingPreview = false;
        this.touchDownOnPreview = false;
        editTouchPreviewStore.set(undefined);
    }

    public clear(): void {
        super.clear();
        this.setAreaPreviewsVisibility(false);
        this.deleteAreaPreview();
        this.unbindEventHandlers();
        this.unsubscribeStore();
        this.unbindEntitiesManagerEventHandlers();
    }

    /**
     * React on commands coming from the outside
     */
    public async handleIncomingCommandMessage(editMapCommandMessage: EditMapCommandMessage): Promise<void> {
        const commandId = editMapCommandMessage.id;
        switch (editMapCommandMessage.editMapMessage?.message?.$case) {
            case "createEntityMessage": {
                const createEntityMessage = editMapCommandMessage.editMapMessage?.message.createEntityMessage;
                const entityPrefab = await this.scene
                    .getEntitiesCollectionsManager()
                    .getEntityPrefab(createEntityMessage.collectionName, createEntityMessage.prefabId);

                if (!entityPrefab) {
                    console.warn(
                        `NO PREFAB WAS FOUND FOR: ${createEntityMessage.collectionName} ${createEntityMessage.prefabId}`
                    );
                    return;
                }

                TexturesHelper.loadEntityImage(this.scene, entityPrefab.imagePath, entityPrefab.imagePath)
                    .then(() => {
                        this.entitiesManager
                            .getEntities()
                            .get(createEntityMessage.id)
                            ?.setTexture(entityPrefab.imagePath);
                    })
                    .catch((reason) => {
                        console.warn(reason);
                    });

                const entityData: WAMEntityData = {
                    x: createEntityMessage.x,
                    y: createEntityMessage.y,
                    prefabRef: {
                        id: entityPrefab.id,
                        collectionName: entityPrefab.collectionName,
                    },
                    properties: createEntityMessage.properties,
                    name: createEntityMessage.name,
                };
                // execute command locally
                await this.mapEditorModeManager.executeLocalCommand(
                    new CreateEntityFrontCommand(
                        this.scene.getGameMap(),
                        createEntityMessage.id,
                        entityData,
                        commandId,
                        this.entitiesManager,
                        { width: createEntityMessage.width, height: createEntityMessage.height }
                    )
                );
                break;
            }
            case "deleteEntityMessage": {
                const id = editMapCommandMessage.editMapMessage?.message.deleteEntityMessage.id;
                await this.mapEditorModeManager.executeLocalCommand(
                    new DeleteEntityFrontCommand(this.scene.getGameMap(), id, commandId, this.entitiesManager)
                );
                break;
            }
            case "modifyEntityMessage": {
                const modifyEntityMessage = editMapCommandMessage.editMapMessage?.message.modifyEntityMessage;
                await this.mapEditorModeManager.executeLocalCommand(
                    new UpdateEntityFrontCommand(
                        this.scene.getGameMap(),
                        modifyEntityMessage.id,
                        {
                            ...modifyEntityMessage,
                            properties: modifyEntityMessage.modifyProperties
                                ? modifyEntityMessage.properties
                                : undefined,
                        },
                        commandId,
                        undefined,
                        this.entitiesManager,
                        this.scene
                    )
                );
                break;
            }
            case "uploadEntityMessage": {
                const uploadEntityMessage = editMapCommandMessage.editMapMessage?.message.uploadEntityMessage;
                await this.mapEditorModeManager.executeLocalCommand(
                    new UploadEntityFrontCommand(
                        uploadEntityMessage,
                        this.entitiesManager,
                        this.scene.getEntitiesCollectionsManager()
                    )
                );
                break;
            }
            case "modifyCustomEntityMessage": {
                const modifyCustomEntityMessage =
                    editMapCommandMessage.editMapMessage?.message.modifyCustomEntityMessage;
                await this.mapEditorModeManager.executeLocalCommand(
                    new ModifyCustomEntityFrontCommand(
                        modifyCustomEntityMessage,
                        this.scene.getEntitiesCollectionsManager(),
                        this.scene.getGameMapFrontWrapper(),
                        this.entitiesManager
                    )
                );
                break;
            }
            case "deleteCustomEntityMessage": {
                const deleteCustomEntityMessage =
                    editMapCommandMessage.editMapMessage?.message.deleteCustomEntityMessage;
                await this.mapEditorModeManager.executeLocalCommand(
                    new DeleteCustomEntityFrontCommand(
                        deleteCustomEntityMessage,
                        this.scene.getGameMap(),
                        this.entitiesManager,
                        this.scene.getEntitiesCollectionsManager()
                    )
                );
                break;
            }
        }
    }

    public destroy() {
        super.destroy();
        this.unbindEventHandlers();
        this.unbindEntitiesManagerEventHandlers();
        this.unsubscribeStore();
        this.setAreaPreviewsVisibility(false);
        this.deleteAreaPreview();
    }

    protected bindEntitiesManagerEventHandlers(): void {
        this.entitiesManager.on(EntitiesManagerEvent.UpdateEntity, this.handleUpdateEntity);
        this.entitiesManager.on(EntitiesManagerEvent.CopyEntity, this.handleCopyEntity);
    }

    protected bindEventHandlers() {
        this.pointerMoveEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) =>
            this.handlePointerMoveEvent(pointer, gameObjects);
        this.scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveEventHandler);

        this.pointerDownEventHandler = (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]) =>
            this.handlePointerDownEvent(pointer, gameObjects);
        this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.pointerDownEventHandler);
        this.scene.input.on(Phaser.Input.Events.POINTER_UP, this.touchPointerUpHandler);

        this.shiftKey?.on(Phaser.Input.Keyboard.Events.DOWN, () => {
            this.changePreviewTint();
        });

        this.shiftKey?.on(Phaser.Input.Keyboard.Events.UP, () => {
            this.changePreviewTint();
        });
    }

    protected subscribeToEntityUpload() {
        this.mapEditorEntityUploadStoreUnsubscriber = mapEditorEntityUploadEventStore.subscribe(
            (uploadEntityMessage) => {
                if (uploadEntityMessage) {
                    (async () => {
                        await this.mapEditorModeManager.executeCommand(
                            new UploadEntityFrontCommand(
                                uploadEntityMessage,
                                this.entitiesManager,
                                this.scene.getEntitiesCollectionsManager()
                            )
                        );
                        mapEditorEntityUploadEventStore.set(undefined);
                    })().catch((e) => {
                        console.error(e);
                        Sentry.captureException(e);
                    });
                }
            }
        );
    }

    protected subscribeToModifyCustomEntityEventStore() {
        this.mapEditorModifyCustomEntityEventStoreUnsubscriber = mapEditorModifyCustomEntityEventStore.subscribe(
            (modifyCustomEntityMessage) => {
                if (modifyCustomEntityMessage) {
                    (async () => {
                        await this.mapEditorModeManager.executeCommand(
                            new ModifyCustomEntityFrontCommand(
                                modifyCustomEntityMessage,
                                this.scene.getEntitiesCollectionsManager(),
                                this.scene.getGameMapFrontWrapper(),
                                this.entitiesManager
                            )
                        );
                        mapEditorModifyCustomEntityEventStore.set(undefined);
                    })().catch((e) => {
                        console.error(e);
                        Sentry.captureException(e);
                    });
                }
            }
        );
    }

    protected subscribeToDeleteCustomEntityEventStore() {
        this.mapEditorDeleteCustomEntityEventStoreUnsubscriber = mapEditorDeleteCustomEntityEventStore.subscribe(
            (deleteCustomEntityMessage) => {
                if (deleteCustomEntityMessage) {
                    (async () => {
                        await this.mapEditorModeManager.executeCommand(
                            new DeleteCustomEntityFrontCommand(
                                deleteCustomEntityMessage,
                                this.scene.getGameMap(),
                                this.entitiesManager,
                                this.scene.getEntitiesCollectionsManager()
                            )
                        );
                        mapEditorDeleteCustomEntityEventStore.set(undefined);
                    })().catch((e) => {
                        console.error(e);
                        Sentry.captureException(e);
                    });
                }
            }
        );
    }

    protected handlePointerMoveEvent(
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ): void {
        // TODO: add shadow when moving into the area
        // .setDropShadow(4, 4, 0x000000);
        if (!this.entityPrefabPreview || !this.entityPrefab) {
            return;
        }

        // With a finger, the preview waits where it was tapped and only follows a drag that started on it.
        if (pointer.wasTouch) {
            if (!this.touchDraggingPreview || !pointer.isDown) return;
        }
        this.movePreviewTo(pointer.worldX, pointer.worldY);
        if (pointer.wasTouch) this.publishTouchPreview();
    }

    /** Move the preview to a world position, snapping to the tile grid when the object or Shift asks for it. */
    private movePreviewTo(worldX: number, worldY: number): void {
        if (!this.entityPrefabPreview || !this.entityPrefab) {
            return;
        }
        if (this.entityPrefab.collisionGrid || this.shiftKey?.isDown) {
            const offset = this.getEntityPrefabAlignWithGridOffset();
            this.entityPrefabPreview.setPosition(
                Math.floor(worldX / 32) * 32 + offset.x,
                Math.floor(worldY / 32) * 32 + offset.y
            );
        } else {
            this.entityPrefabPreview.setPosition(Math.floor(worldX), Math.floor(worldY));
        }
        this.entityPrefabPreview.setDepth(
            this.entityPrefabPreview.y +
                this.entityPrefabPreview.displayHeight * 0.5 +
                (this.entityPrefab.depthOffset ?? 0)
        );
        this.changePreviewTint();
    }

    // Placing with a finger: the first tap puts the preview down, a drag on it moves it, a tap on it (or Done) places it.
    private touchPreviewWaiting = false;
    private touchDraggingPreview = false;
    private touchDownOnPreview = false;

    /** Where the waiting preview is on screen, for the "Tap again to place" pill. */
    private publishTouchPreview(): void {
        if (!this.entityPrefabPreview || !this.touchPreviewWaiting) {
            editTouchPreviewStore.set(undefined);
            return;
        }
        const camera = this.scene.cameras.main;
        const zoom = camera.zoom;
        const topLeft = this.entityPrefabPreview.getTopLeft();
        const next = {
            x: ((topLeft.x ?? 0) - camera.worldView.x) * zoom,
            y: ((topLeft.y ?? 0) - camera.worldView.y) * zoom,
            width: this.entityPrefabPreview.displayWidth * zoom,
            height: this.entityPrefabPreview.displayHeight * zoom,
        };
        const last = get(editTouchPreviewStore);
        if (
            last &&
            last.x === next.x &&
            last.y === next.y &&
            last.width === next.width &&
            last.height === next.height
        ) {
            return;
        }
        editTouchPreviewStore.set(next);
    }

    private isPointerOnPreview(pointer: Phaser.Input.Pointer): boolean {
        if (!this.entityPrefabPreview || !this.touchPreviewWaiting) return false;
        const bounds = this.entityPrefabPreview.getBounds();
        // A finger is wider than the picture: a tap just beside a thin object still counts.
        const margin = 12 / this.scene.cameras.main.zoom;
        return (
            pointer.worldX >= bounds.left - margin &&
            pointer.worldX <= bounds.right + margin &&
            pointer.worldY >= bounds.top - margin &&
            pointer.worldY <= bounds.bottom + margin
        );
    }

    /** A finger on the waiting preview drags the preview, not the map. */
    public canDragToLookAround(pointer: Phaser.Input.Pointer): boolean {
        return !(pointer.wasTouch && this.isPointerOnPreview(pointer));
    }

    /** Stop placing: the "Done" of the placing bar. */
    public stopPlacing(): void {
        this.cleanPreview();
    }

    /** Put a copy of an object right beside it (the "Copy" action). */
    public duplicateEntity(entity: Entity): void {
        const data = entity.getEntityData();
        const step = Math.max(32, Math.ceil(entity.displayWidth / 32) * 32);
        this.copyEntity({
            position: { x: data.x + step, y: data.y },
            prefabRef: data.prefabRef,
            properties: structuredClone(data.properties ?? []),
            entityDimensions: { width: entity.width, height: entity.height },
        });
    }

    /** Place the waiting preview where it is (the "Done" of the placing bar, or a tap on the preview). */
    public placeWaitingPreview(): void {
        if (!this.entityPrefabPreview || !this.entityPrefab || !this.touchPreviewWaiting) return;
        this.placePreview();
    }

    private readonly touchPointerUpHandler = (pointer: Phaser.Input.Pointer) => {
        if (!pointer.wasTouch) return;
        const wasDraggingPreview = this.touchDraggingPreview;
        const downOnPreview = this.touchDownOnPreview;
        this.touchDraggingPreview = false;
        this.touchDownOnPreview = false;
        if (!this.entityPrefabPreview || !this.entityPrefab) return;
        const dragged = pointer.getDistance() > 8;
        if (downOnPreview && !dragged) {
            // A tap on the waiting preview places it.
            this.placePreview();
            return;
        }
        if (wasDraggingPreview) {
            this.publishTouchPreview();
            return;
        }
        if (dragged || this.mapEditorModeManager.isDraggingToLookAround) return;
        // A tap on the empty map puts the preview there, or moves it there, without placing it.
        if (pointer.downElement?.tagName !== "CANVAS") return;
        this.movePreviewTo(pointer.worldX, pointer.worldY);
        this.entityPrefabPreview.setVisible(true);
        this.touchPreviewWaiting = true;
        this.publishTouchPreview();
    };

    protected changePreviewTint(): void {
        if (!this.entityPrefabPreview || !this.entityPrefab) {
            return;
        }
        if (!this.canEntityBePlaced()) {
            this.entityPrefabPreview.setTint(0xff0000);
        } else {
            if (this.shiftKey?.isDown) {
                this.entityPrefabPreview.setTint(0xffa500);
            } else {
                this.entityPrefabPreview.clearTint();
            }
        }
        this.scene.markDirty();
    }

    protected handlePointerDownEvent(
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[]
    ): void {
        if (get(mapEditorEntityModeStore) === "EDIT" && gameObjects.length === 0) {
            mapEditorEntityModeStore.set("ADD");
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            mapEditorSelectedEntityStore.set(undefined);
        }

        if (!this.entityPrefabPreview || !this.entityPrefab) {
            // Check that the user can open map editor to edit an area
            if (get(mapEditorActivated)) {
                const areaEditorToolObjects = gameObjects.filter((obj) => obj instanceof AreaPreview);
                if (areaEditorToolObjects.length > 0 && get(mapEditorSelectedToolStore) !== EditorToolName.AreaEditor) {
                    this.scene.getMapEditorModeManager().equipTool(EditorToolName.AreaEditor);
                }
            }
            return;
        }

        if (pointer.wasTouch) {
            // Nothing is placed on the way down: see touchPointerUpHandler.
            this.touchDownOnPreview = this.isPointerOnPreview(pointer);
            this.touchDraggingPreview = this.touchDownOnPreview;
            return;
        }

        if (!this.canEntityBePlaced()) {
            return;
        }

        if (pointer.rightButtonDown()) {
            this.cleanPreview();
            return;
        }
        this.placePreview();
    }

    /** Create the object where the preview is, and keep placing. */
    private placePreview(): void {
        if (!this.entityPrefabPreview || !this.entityPrefab) {
            return;
        }
        if (!this.canEntityBePlaced()) {
            this.changePreviewTint();
            return;
        }
        const x = Math.floor(this.entityPrefabPreview.x);
        const y = Math.floor(this.entityPrefabPreview.y);

        const entityId = uuidv4();

        const properties = get(mapEditorCopiedEntityDataPropertiesStore);

        const entityData: WAMEntityData = {
            x: Math.floor(x - this.entityPrefabPreview.displayWidth * 0.5),
            y: Math.floor(y - this.entityPrefabPreview.displayHeight * 0.5),
            prefabRef: this.entityPrefab,
            properties: properties ?? [],
            name: properties?.find((p) => p.type === "openFile")?.name ?? undefined,
        };

        editRecentObjectsStore.add(this.entityPrefab);
        this.touchPreviewWaiting = false;
        this.publishTouchPreview();
        this.mapEditorModeManager
            .executeCommand(
                new CreateEntityFrontCommand(
                    this.scene.getGameMap(),
                    entityId,
                    entityData,
                    undefined,
                    this.entitiesManager,
                    { width: this.entityPrefabPreview.width, height: this.entityPrefabPreview.height }
                )
            )
            .then(() => {
                const openEntity = this.entitiesManager.getEntities().get(entityId);
                if (get(mapEditorEntityFileDroppedStore)) {
                    // A dropped file is placed once: placing ends and the new object's settings open, with the file
                    // in them, as the old editor did.
                    mapEditorEntityFileDroppedStore.set(false);
                    mapEditorCopiedEntityDataPropertiesStore.set(undefined);
                    mapEditorSelectedEntityPrefabStore.set(undefined);
                    mapEditorEntityModeStore.set("EDIT");
                    mapEditorSelectedEntityStore.set(openEntity);
                    editObjectsViewStore.set("settings");
                    mapEditorVisibilityStore.set(true);
                }
            })
            .catch((e) => console.error(e));
    }

    protected unbindEventHandlers(): void {
        this.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.pointerMoveEventHandler);
        this.shiftKey?.off(Phaser.Input.Keyboard.Events.DOWN);
        this.shiftKey?.off(Phaser.Input.Keyboard.Events.UP);
        this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.pointerDownEventHandler);
        this.scene.input.off(Phaser.Input.Events.POINTER_UP, this.touchPointerUpHandler);
        this.touchPreviewWaiting = false;
        this.touchDraggingPreview = false;
        editTouchPreviewStore.set(undefined);
    }

    protected unbindEntitiesManagerEventHandlers(): void {
        this.entitiesManager.off(EntitiesManagerEvent.UpdateEntity, this.handleUpdateEntity);
        this.entitiesManager.off(EntitiesManagerEvent.CopyEntity, this.handleCopyEntity);
    }

    protected createAreaPreviews(): AreaPreview[] {
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

    protected createAreaPreview(areaConfig: AreaData): AreaPreview {
        const areaPreview = new AreaPreview(
            this.scene,
            structuredClone(areaConfig),
            false,
            this.shiftKey,
            this.ctrlKey
        );
        this.areaPreviews.push(areaPreview);
        return areaPreview;
    }

    protected setAreaPreviewsVisibility(visible: boolean): void {
        // NOTE: I would really like to use Phaser Layers here but it seems that there's a problem with Areas still being
        //       interactive when we hide whole Layer and thus forEach is needed.
        this.areaPreviews.forEach((area) => area.setVisible(visible));
    }

    protected deleteAreaPreview(): void {
        this.areaPreviews.forEach((preview) => preview.destroy());
    }

    protected getAreasFromPosition(x: number, y: number): AreaData[] {
        const areasPreview = this.scene.getGameMapFrontWrapper().getAreas();
        if (!areasPreview) {
            return [];
        }
        return Array.from(areasPreview.values()).filter((area: AreaData) => {
            return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
        });
    }

    private canEntityBePlaced(): boolean {
        const gameMapFrontWrapper = this.scene.getGameMapFrontWrapper();
        if (!this.entityPrefabPreview || !this.entityPrefab) {
            return false;
        }
        return gameMapFrontWrapper.canEntityBePlacedOnMap(
            this.entityPrefabPreview.getTopLeft(),
            this.entityPrefabPreview.displayWidth,
            this.entityPrefabPreview.displayHeight,
            this.entityPrefab.collisionGrid,
            undefined,
            this.shiftKey?.isDown
        );
    }

    private updateEntity(entityData: EntityData) {
        // Create commande to update entity data
        this.mapEditorModeManager
            .executeCommand(
                new UpdateEntityFrontCommand(
                    this.scene.getGameMap(),
                    entityData.id,
                    {
                        ...entityData,
                    },
                    undefined,
                    undefined,
                    this.entitiesManager,
                    this.scene
                )
            )
            .catch((e) => console.error(e));
    }

    private copyEntity = (data: CopyEntityEventData) => {
        if (!CopyEntityEventData.parse(data)) {
            return;
        }
        const entityData: WAMEntityData = {
            x: data.position.x,
            y: data.position.y,
            prefabRef: data.prefabRef,
            properties: data.properties ?? [],
        };
        this.mapEditorModeManager
            .executeCommand(
                new CreateEntityFrontCommand(
                    this.scene.getGameMap(),
                    undefined,
                    entityData,
                    undefined,
                    this.entitiesManager,
                    data.entityDimensions
                )
            )
            .catch((e) => console.error(e));
        this.cleanPreview();
    };

    private unsubscribeStore() {
        this.mapEditorEntityUploadStoreUnsubscriber?.();
        this.mapEditorModifyCustomEntityEventStoreUnsubscriber?.();
        this.mapEditorDeleteCustomEntityEventStoreUnsubscriber?.();
    }
}
