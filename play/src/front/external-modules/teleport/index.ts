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
                    universe?: string;
                    world?: string;
                    room?: string;
                    startArea?: string;
                };

                if (!teleportData?.universe || !teleportData?.world || !teleportData?.room) {
                    console.warn("Teleport property missing required fields (universe, world, room)");
                    return;
                }

                // Build full URL in format: http://host/@/universe/world/room#startArea
                // Exit areas use full URLs, not relative @/ paths
                const currentUrl = new URL(window.location.toString());
                let roomUrl = `${currentUrl.protocol}//${currentUrl.host}/@/${teleportData.universe}/${teleportData.world}/${teleportData.room}`;
                if (teleportData.startArea && teleportData.startArea.trim() !== "") {
                    roomUrl += `#${teleportData.startArea}`;
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
