import type { DeleteCustomEntityMessage } from "@workadventure/messages";
import { Command } from "../Command";
import type { GameMap } from "../../GameMap/GameMap";

/** The pictures a delete removes: every picture of the upload when it deletes the whole upload (#1690), else one. */
export function pictureIdsOf(message: DeleteCustomEntityMessage): string[] {
    return message.wholeUpload && message.pictureIds.length > 0 ? message.pictureIds : [message.id];
}

export class DeleteCustomEntityCommand extends Command {
    protected deleteCustomEntityMessage: DeleteCustomEntityMessage;
    protected hostname: string | undefined;
    protected gameMap: GameMap | undefined;

    constructor(deleteCustomEntityMessage: DeleteCustomEntityMessage, gameMap?: GameMap, hostname?: string) {
        super();
        this.deleteCustomEntityMessage = deleteCustomEntityMessage;
        this.hostname = hostname;
        this.gameMap = gameMap;
    }

    execute(): Promise<void> {
        for (const id of pictureIdsOf(this.deleteCustomEntityMessage)) {
            this.gameMap?.getGameMapEntities()?.deleteCustomEntities(id);
        }
        return Promise.resolve();
    }
}
