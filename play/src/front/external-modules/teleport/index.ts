import type { AreaData, AreaDataProperties } from "@workadventure/map-editor";
import type {
    ExtensionModule,
    ExtensionModuleOptions,
    ExtensionModuleAreaProperty,
} from "../../ExternalModule/ExtensionModule";
import { gameManager } from "../../Phaser/Game/GameManager";
import { Room } from "../../Connection/Room";
import TeleportPropertyEditor from "./TeleportPropertyEditor.svelte";
import AddTeleportPropertyButton from "./AddTeleportPropertyButton.svelte";

const teleportExtensionModule: ExtensionModule = {
    id: "teleport-extension",
    calendarSynchronised: false,
    todoListSynchronized: false,

    init(roomMetadata: unknown, options: ExtensionModuleOptions) {
        console.log("Teleport Extension Module initialized");
    },

    destroy() {
        console.log("Teleport Extension Module destroyed");
    },

    areaMapEditor() {
        const teleportAreaProperty: ExtensionModuleAreaProperty = {
            AreaPropertyEditor: TeleportPropertyEditor,
            AddAreaPropertyButton: AddTeleportPropertyButton,
            handleAreaPropertyOnEnter(area: AreaData, signal: AbortSignal) {
                const property = area.properties.find(
                    (prop) => prop.type === "extensionModule" && (prop as { subtype?: string }).subtype === "teleport"
                );

                if (!property) {
                    return;
                }

                const extensionProperty = property as { subtype: string; data: unknown };
                const teleportData = extensionProperty.data as {
                    url?: string;
                    startArea?: string;
                };

                if (!teleportData?.url || !teleportData.url.trim()) {
                    console.warn("Teleport property missing required URL field");
                    return;
                }

                // Build full URL with start area if provided
                let roomUrl = teleportData.url.trim();
                if (teleportData.startArea && teleportData.startArea.trim() !== "") {
                    // Remove existing hash if present, then add start area
                    const urlWithoutHash = roomUrl.split("#")[0];
                    roomUrl = `${urlWithoutHash}#${teleportData.startArea.trim()}`;
                }

                // Navigate to the room using the same mechanism as exit areas
                const scene = gameManager.getCurrentGameScene();
                if (scene) {
                    scene
                        .onMapExit(Room.getRoomPathFromExitUrl(roomUrl, window.location.toString()))
                        .catch((e) => console.error("Error navigating to teleport destination:", e));
                }
            },

            handleAreaPropertyOnLeave(area?: AreaData) {
                // No cleanup needed for teleport
            },

            shouldDisplayButton(areaProperties: AreaDataProperties) {
                // Always show the button if the area doesn't already have a teleport property
                return !areaProperties.some(
                    (prop) => prop.type === "extensionModule" && (prop as { subtype?: string }).subtype === "teleport"
                );
            },
        };

        return {
            teleport: teleportAreaProperty,
        };
    },
};

export default teleportExtensionModule;
