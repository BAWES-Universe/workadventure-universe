import { Metadata } from "@grpc/grpc-js";
import type { RoomsList } from "@workadventure/messages";
import { GRPC_MAX_MESSAGE_SIZE } from "../enums/EnvironmentVariable";
import { apiClientRepository } from "./ApiClientRepository";

/**
 * How many people are in each open room right now, by room URL, asked of every back server. A back that does not
 * answer within a second is left out: its rooms count as empty.
 */
export async function getPeopleInRooms(): Promise<Map<string, number>> {
    const roomClients = await apiClientRepository.getAllClients(GRPC_MAX_MESSAGE_SIZE);
    const lists = await Promise.allSettled(
        roomClients.map(
            (roomClient) =>
                new Promise<RoomsList>((resolve, reject) => {
                    roomClient.getRooms({}, new Metadata(), { deadline: Date.now() + 1000 }, (error, result) => {
                        if (error) reject(error);
                        else resolve(result);
                    });
                })
        )
    );
    const people = new Map<string, number>();
    for (const list of lists) {
        if (list.status !== "fulfilled") continue;
        for (const room of list.value.roomDescription) {
            people.set(room.roomId, (people.get(room.roomId) ?? 0) + room.nbUsers);
        }
    }
    return people;
}
