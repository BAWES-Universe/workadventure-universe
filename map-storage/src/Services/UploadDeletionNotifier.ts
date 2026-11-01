import { ApiClientRepository } from "@workadventure/shared-utils/src/ApiClientRepository";
import type { EditMapCommandMessage } from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import { API_URL, GRPC_MAX_MESSAGE_SIZE } from "../Enum/EnvironmentVariable";

/**
 * Tells every back server that an upload was deleted with all its copies (#1722). The rooms of a world can sit on
 * different back servers, and only the back server that holds a room can tell the people in it, so all of them are asked,
 * the way UploadDetector tells them that an upload appeared.
 */
export class UploadDeletionNotifier {
    private apiClientRepository: ApiClientRepository;

    public constructor(apiUrls = API_URL.split(",")) {
        this.apiClientRepository = new ApiClientRepository(apiUrls);
    }

    /**
     * @param wamUrls The map files of the other rooms of the world.
     * @param command The delete, as the people in those rooms receive it.
     */
    public async tell(wamUrls: string[], command: EditMapCommandMessage): Promise<void> {
        if (wamUrls.length === 0) return;
        const clients = await this.apiClientRepository.getAllClients(GRPC_MAX_MESSAGE_SIZE);
        for (const client of clients) {
            client.handleMapStorageUploadDeleted({ wamUrls, command }, (err) => {
                if (err) {
                    console.error(`[${new Date().toISOString()}]`, err);
                    Sentry.captureException(err);
                }
            });
        }
    }
}

export const uploadDeletionNotifier = new UploadDeletionNotifier();
