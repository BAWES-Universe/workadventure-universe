import type { GameMap, WAMEntityData } from "@workadventure/map-editor";
import { DeleteEntityCommand } from "@workadventure/map-editor";
import type { EntitiesManager } from "../../../GameMap/EntitiesManager";
import type { FrontCommandInterface } from "../FrontCommandInterface";
import type { RoomConnection } from "../../../../../Connection/RoomConnection";
import { VoidFrontCommand } from "../VoidFrontCommand";
import { CreateEntityFrontCommand } from "./CreateEntityFrontCommand";

export class DeleteEntityFrontCommand extends DeleteEntityCommand implements FrontCommandInterface {
    private entityData: WAMEntityData | undefined;
    private entityDimensions: { width: number; height: number } | undefined;

    constructor(
        gameMap: GameMap,
        entityId: string,
        commandId: string | undefined,
        private entitiesManager: EntitiesManager
    ) {
        super(gameMap, entityId, commandId);
    }

    public execute(): Promise<void> {
        const entityData = this.gameMap.getGameMapEntities()?.getEntity(this.entityId);
        if (!entityData) {
            throw new Error("Trying to delete a non existing Entity!");
        }
        this.entityData = structuredClone(entityData);
        // Kept for Undo: once deleted, the object is no longer on the map to measure.
        const entity = this.entitiesManager.getEntities().get(this.entityId);
        if (entity) this.entityDimensions = { width: entity.width, height: entity.height };
        this.entitiesManager.deleteEntity(this.entityId);
        return super.execute();
    }

    public getUndoCommand(): CreateEntityFrontCommand | VoidFrontCommand {
        // Undo puts the object back. It used to look the deleted object up on the map (by its prefab id), never
        // found it, and so undid nothing.
        if (!this.entityData || !this.entityDimensions) {
            return new VoidFrontCommand();
        }
        return new CreateEntityFrontCommand(
            this.gameMap,
            this.entityId,
            this.entityData,
            undefined,
            this.entitiesManager,
            this.entityDimensions
        );
    }

    public emitEvent(roomConnection: RoomConnection): void {
        roomConnection.emitMapEditorDeleteEntity(this.commandId, this.entityId);
    }
}
