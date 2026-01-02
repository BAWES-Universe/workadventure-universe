import { ModifyCustomEntityCommand } from "@workadventure/map-editor";
import type { ModifyCustomEntityMessage } from "@workadventure/messages";
import { CustomEntityCollectionService } from "../../Services/CustomEntityCollectionService";

export class ModifyCustomEntityMapStorageCommand extends ModifyCustomEntityCommand {
    private customEntityCollectionService: CustomEntityCollectionService;

    constructor(modifyCustomEntityMessage: ModifyCustomEntityMessage, hostName: string, universeWorldPath: string) {
        super(modifyCustomEntityMessage, hostName);
        this.customEntityCollectionService = new CustomEntityCollectionService(hostName, universeWorldPath);
    }
    async execute(): Promise<void> {
        await super.execute();
        return this.customEntityCollectionService.modifyEntity(this.modifyCustomEntityMessage);
    }
}
