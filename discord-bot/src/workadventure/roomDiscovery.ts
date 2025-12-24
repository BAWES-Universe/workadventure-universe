import axios, { AxiosError } from "axios";
import type { RoomStats } from "../types";

export class RoomDiscovery {
    private pusherUrl: string;
    private adminApiToken: string;
    private pollInterval: number;
    private knownRooms: Set<string> = new Set();
    private pollTimer: NodeJS.Timeout | null = null;

    constructor(pusherUrl: string, adminApiToken: string, pollInterval: number = 30000) {
        this.pusherUrl = pusherUrl;
        this.adminApiToken = adminApiToken;
        this.pollInterval = pollInterval;
    }

    /**
     * Fetch all active rooms from WorkAdventure
     */
    async fetchRooms(): Promise<RoomStats> {
        try {
            const response = await axios.get<RoomStats>(`${this.pusherUrl}/rooms`, {
                headers: {
                    "admin-token": this.adminApiToken,
                },
            });
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error(`Failed to fetch rooms: ${error.message}`);
            } else {
                console.error("Unexpected error fetching rooms:", error);
            }
            return {};
        }
    }

    /**
     * Get newly discovered rooms (rooms not seen before)
     */
    async getNewRooms(): Promise<string[]> {
        const currentRooms = await this.fetchRooms();
        const currentRoomIds = Object.keys(currentRooms);
        const newRooms: string[] = [];

        for (const roomId of currentRoomIds) {
            if (!this.knownRooms.has(roomId)) {
                newRooms.push(roomId);
                this.knownRooms.add(roomId);
            }
        }

        // Remove rooms that are no longer active
        for (const knownRoom of this.knownRooms) {
            if (!currentRoomIds.includes(knownRoom)) {
                this.knownRooms.delete(knownRoom);
            }
        }

        return newRooms;
    }

    /**
     * Get all currently known rooms
     */
    getAllRooms(): string[] {
        return Array.from(this.knownRooms);
    }

    /**
     * Start polling for new rooms
     */
    startPolling(onNewRooms: (rooms: string[]) => void): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
        }

        // Initial poll
        this.getNewRooms().then((newRooms) => {
            if (newRooms.length > 0) {
                onNewRooms(newRooms);
            }
        });

        // Set up periodic polling
        this.pollTimer = setInterval(async () => {
            const newRooms = await this.getNewRooms();
            if (newRooms.length > 0) {
                onNewRooms(newRooms);
            }
        }, this.pollInterval);
    }

    /**
     * Stop polling for new rooms
     */
    stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Get current room stats
     */
    async getRoomStats(): Promise<RoomStats> {
        return await this.fetchRooms();
    }
}

