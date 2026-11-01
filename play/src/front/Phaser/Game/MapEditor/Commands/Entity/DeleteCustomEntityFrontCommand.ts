import type { Command, GameMap } from "@workadventure/map-editor";
import { DeleteCustomEntityCommand, pictureIdsOf } from "@workadventure/map-editor";
import type { DeleteCustomEntityMessage } from "@workadventure/messages";
import type { RoomConnection } from "../../../../../Connection/RoomConnection";
import type { FrontCommand } from "../FrontCommand";
import type { EntitiesManager } from "../../../GameMap/EntitiesManager";
import type { EntitiesCollectionsManager } from "../../EntitiesCollectionsManager";

export class DeleteCustomEntityFrontCommand extends DeleteCustomEntityCommand implements FrontCommand {
    constructor(
        deleteCustomEntityMessage: DeleteCustomEntityMessage,
        gameMap: GameMap,
        private entitiesManager: EntitiesManager,
        private entitiesCollectionManager: EntitiesCollectionsManager
    ) {
        super(deleteCustomEntityMessage, gameMap);
    }

    emitEvent(roomConnection: RoomConnection): void {
        roomConnection.emitMapEditorDeleteCustomEntity(this.commandId, this.deleteCustomEntityMessage);
    }

    execute(): Promise<void> {
        // Deleting an upload takes every picture of it and every placed copy (#1690).
        for (const id of pictureIdsOf(this.deleteCustomEntityMessage)) {
            this.entitiesCollectionManager.deleteCustomEntity(id);
            const gameMapEntitiesIdToRemove = this.gameMap?.getGameMapEntities()?.findEntitiesByPrefabId(id) ?? [];
            this.entitiesManager.deleteEntities(gameMapEntitiesIdToRemove);
        }
        return super.execute();
    }

    getUndoCommand(): Command & FrontCommand {
        throw new Error("Not supported.");
    }
}
