import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";

/**
 * Below this width (Tailwind's `md`) the map editor uses its mobile layout.
 * Screen size only decides layout, never which tools are available.
 */
export const MAP_EDITOR_MOBILE_MAX_WIDTH = 768;

export interface MapEditorToolPermissions {
    mapEditorActivated: boolean;
    mapEditorActivatedForThematics: boolean;
}

export interface MapEditorToolDescriptor {
    toolName: EditorToolName;
    /** The tool works on touch screens but is not touch-ready yet; show it with a "works best on desktop" hint. */
    worksBestOnDesktop: boolean;
}

/**
 * The tools the user is allowed to use, from permissions only.
 * The bot editor is not in this list: the bots extension module adds its own button.
 */
export function getMapEditorTools(permissions: MapEditorToolPermissions): MapEditorToolDescriptor[] {
    const tools: MapEditorToolDescriptor[] = [{ toolName: EditorToolName.ExploreTheRoom, worksBestOnDesktop: false }];

    if (permissions.mapEditorActivated) {
        tools.push(
            { toolName: EditorToolName.AreaEditor, worksBestOnDesktop: true },
            { toolName: EditorToolName.EntityEditor, worksBestOnDesktop: false },
            { toolName: EditorToolName.WAMSettingsEditor, worksBestOnDesktop: false },
            { toolName: EditorToolName.TrashEditor, worksBestOnDesktop: false }
        );
    } else if (permissions.mapEditorActivatedForThematics) {
        tools.push(
            { toolName: EditorToolName.EntityEditor, worksBestOnDesktop: false },
            { toolName: EditorToolName.TrashEditor, worksBestOnDesktop: false }
        );
    }

    return tools;
}
