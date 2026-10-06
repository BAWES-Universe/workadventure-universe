import { FILE_UPLOAD_SUPPORTED_FORMATS_FRONT } from "@workadventure/map-editor";
import type { EntityPrefab, OpenFilePropertyData } from "@workadventure/map-editor";
import { get } from "svelte/store";
import { v4 as uuidv4 } from "uuid";
import { draggingFile, draggingFilePosition } from "../../Stores/FileUploadStore";
import { popupStore } from "../../Stores/PopupStore";
import { gameManager } from "../Game/GameManager";
import { warningMessageStore } from "../../Stores/ErrorStore";
import { userIsConnected } from "../../Stores/MenuStore";
import PopUpConnect from "../../Components/PopUp/PopUpConnect.svelte";
import LL from "../../../i18n/i18n-svelte";
import { GRPC_MAX_MESSAGE_SIZE } from "../../Enum/EnvironmentVariable";
import { gameSceneStore } from "../../Stores/GameSceneStore";
import { ON_ACTION_TRIGGER_BUTTON } from "../../WebRtc/LayoutManager";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import {
    mapEditorCopiedEntityDataPropertiesStore,
    mapEditorEntityFileDroppedStore,
    mapEditorEntityModeStore,
    mapEditorSelectedEntityPrefabStore,
    mapEditorToolbarInUseStore,
} from "../../Stores/MapEditorStore";
import { isCalendarVisibleStore } from "../../Stores/CalendarStore";
import { isTodoListVisibleStore } from "../../Stores/TodoListStore";
import { EditorToolName } from "../Game/MapEditor/MapEditorModeManager";
import { EntityEditorTool } from "../Game/MapEditor/Tools/EntityEditorTool";
import { UploadFileFrontCommand } from "../Game/MapEditor/Commands/File/UploadFileFrontCommand";
import { installStrayFileDropGuard, isFileDrag, uninstallStrayFileDropGuard } from "../../Utils/strayFileDropGuard";

/** The look a dropped file gets: a pile of books, as before. Another look is picked by placing that object and adding
 * the file in its settings. */
const DROPPED_FILE_PREFAB_ID = "basic office decoration:Books (Variant 5):black:Down";

/**
 * Files dropped on the map. Only in edit mode: while playing, the map shows no drop sign and takes no file, so nobody
 * is offered something they are then told they cannot do. The file lands where it is dropped, on an object that opens
 * it, and that object's settings open.
 */
export class FileListener {
    private canvas: HTMLCanvasElement;

    private boundDragOverHandler: (event: DragEvent) => void;
    private boundDragLeaveHandler: (event: DragEvent) => void;
    private boundDragEnterHandler: (event: DragEvent) => void;
    private boundDropHandler: (event: DragEvent) => void;
    private BYTES_TO_MB = 1024 * 1024;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        this.boundDragOverHandler = this.dragOverHandler.bind(this);
        this.boundDragLeaveHandler = this.dragLeaveHandler.bind(this);
        this.boundDragEnterHandler = this.dragEnterHandler.bind(this);
        this.boundDropHandler = this.dropHandler.bind(this);
    }

    public initDomListeners() {
        installStrayFileDropGuard();
        this.canvas.addEventListener("dragover", this.boundDragOverHandler);
        this.canvas.addEventListener("dragleave", this.boundDragLeaveHandler);
        this.canvas.addEventListener("dragenter", this.boundDragEnterHandler);
        this.canvas.addEventListener("dragend", this.boundDragLeaveHandler);
        this.canvas.addEventListener("drop", this.boundDropHandler);
    }

    public close() {
        uninstallStrayFileDropGuard();
        this.canvas.removeEventListener("dragover", this.boundDragOverHandler);
        this.canvas.removeEventListener("dragleave", this.boundDragLeaveHandler);
        this.canvas.removeEventListener("dragenter", this.boundDragEnterHandler);
        this.canvas.removeEventListener("dragend", this.boundDragLeaveHandler);
        this.canvas.removeEventListener("drop", this.boundDropHandler);
    }

    /** The map takes a file only while edit mode is open (not while looking around). */
    private acceptsDrop(event: DragEvent): boolean {
        return isFileDrag(event) && get(mapEditorToolbarInUseStore);
    }

    public dropHandler(event: DragEvent) {
        if (!this.acceptsDrop(event)) {
            this.endDrag();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.endDrag();

        const gameScene = gameManager.getCurrentGameScene();

        const userIsAdmin = gameScene.connection?.isAdmin();
        const userIsEditor = gameScene.connection?.hasTag("editor");

        const gameMapAreas = gameScene.getGameMap().getGameMapAreas();
        const userId = gameScene.connection?.getUserId();
        const userTags = gameScene.connection?.getAllTags() ?? [];

        if (!get(userIsConnected)) {
            popupStore.addPopup(PopUpConnect, {}, "popupConnect");
            return;
        }

        if (
            !userIsAdmin &&
            !userIsEditor &&
            !gameMapAreas?.isGameMapContainsSpecificAreas(userId?.toString(), userTags)
        ) {
            warningMessageStore.addWarningMessage(get(LL).mapEditor.entityEditor.errors.dragNotAllowed(), {
                closable: true,
            });
            return;
        }

        const { files: filesFromDropEvent } = event.dataTransfer ?? {};
        if (!filesFromDropEvent) return;
        if (filesFromDropEvent.length > 1) {
            warningMessageStore.addWarningMessage(get(LL).mapEditor.entityEditor.uploadEntity.errorOnFileNumber(), {
                closable: true,
            });
            return;
        }
        const file = filesFromDropEvent.item(0);
        if (!file) return;

        if (file.size && file.size > GRPC_MAX_MESSAGE_SIZE) {
            warningMessageStore.addWarningMessage(
                get(LL).mapEditor.entityEditor.uploadEntity.errorOnFileSize({
                    size: GRPC_MAX_MESSAGE_SIZE / this.BYTES_TO_MB,
                }),
                { closable: true }
            );
            return;
        }

        if (!this.isASupportedFormat(file.type)) {
            console.error("File format not supported", file.type);
            warningMessageStore.addWarningMessage(get(LL).mapEditor.entityEditor.uploadEntity.errorOnFileFormat(), {
                closable: true,
            });
            return;
        }

        this.placeDroppedFile(file, event.clientX, event.clientY).catch((error) => {
            console.error("Could not place the dropped file", error);
            warningMessageStore.addWarningMessage(String(error instanceof Error ? error.message : error), {
                closable: true,
            });
        });
    }

    /** Upload the file, then put an object that opens it where it was dropped. */
    private async placeDroppedFile(file: File, clientX: number, clientY: number): Promise<void> {
        const scene = gameManager.getCurrentGameScene();
        const entitiesCollectionsManager = scene.getEntitiesCollectionsManager();

        let entityPrefab: EntityPrefab | undefined = await entitiesCollectionsManager.getEntityPrefab(
            "All Object Collection",
            DROPPED_FILE_PREFAB_ID
        );
        if (!entityPrefab) {
            entityPrefab = get(entitiesCollectionsManager.getEntitiesPrefabsVariantStore())[0]?.defaultPrefab;
        }
        if (!entityPrefab) {
            throw new Error("No object to hold the file");
        }

        const propertyId = uuidv4();

        const lastDot = file.name.lastIndexOf(".");
        const name = file.name.slice(0, lastDot);
        const fileExt = file.name.slice(lastDot + 1);

        const mapStorageUrl = get(gameSceneStore)?.room.mapStorageUrl;
        if (!mapStorageUrl) {
            throw new Error("Map storage URL is not available");
        }
        // Files are stored at map-storage root, not relative to WAM file
        // Construct URL relative to map-storage origin
        const filePath = `private/files/${name}-${propertyId}.${fileExt}`;
        const fileUrl = new URL(filePath, `${mapStorageUrl.protocol}//${mapStorageUrl.host}`).toString();

        const fileBuffer = await file.arrayBuffer();
        const fileToUpload = {
            id: uuidv4(),
            file: new Uint8Array(fileBuffer),
            name: file.name,
            propertyId,
        };

        const roomConnection = scene.connection;
        if (!roomConnection) {
            throw new Error("No room connection");
        }

        new UploadFileFrontCommand(fileToUpload).emitEvent(roomConnection);

        const property: OpenFilePropertyData = {
            type: "openFile",
            newTab: false,
            link: fileUrl,
            id: propertyId,
            name: file.name,
            buttonLabel: "Open File",
            trigger: ON_ACTION_TRIGGER_BUTTON,
            triggerMessage: "",
            closable: true,
            width: 50,
            hideUrl: false,
        };

        const mapEditorModeManager = scene.getMapEditorModeManager();

        analyticsClient.dragDropFile();
        mapEditorModeManager.equipTool(EditorToolName.EntityEditor);
        mapEditorEntityFileDroppedStore.set(true);
        mapEditorEntityModeStore.set("ADD");
        mapEditorSelectedEntityPrefabStore.set(entityPrefab);
        isTodoListVisibleStore.set(false);
        isCalendarVisibleStore.set(false);
        mapEditorCopiedEntityDataPropertiesStore.update((properties) => {
            const newProperties = properties ? [...properties] : [];
            newProperties.push(property);
            return newProperties;
        });

        const tool = mapEditorModeManager.currentlyActiveTool;
        if (tool instanceof EntityEditorTool) {
            await tool.placeDroppedFileAt(clientX, clientY);
        }
    }

    private dragEnterHandler(event: DragEvent) {
        if (!this.acceptsDrop(event)) return;
        event.preventDefault();
        draggingFile.set(true);
        draggingFilePosition.set({ x: event.clientX, y: event.clientY });
    }

    private dragOverHandler(event: DragEvent) {
        // Outside edit mode the drag is left to the window guard: the cursor says no and the drop does nothing.
        if (!this.acceptsDrop(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        draggingFile.set(true);
        draggingFilePosition.set({ x: event.clientX, y: event.clientY });
    }

    private dragLeaveHandler() {
        this.endDrag();
    }

    private endDrag() {
        draggingFile.set(false);
        draggingFilePosition.set(undefined);
    }

    private isASupportedFormat(format: string): boolean {
        return format.trim().length > 0 && FILE_UPLOAD_SUPPORTED_FORMATS_FRONT.includes(format);
    }
}
