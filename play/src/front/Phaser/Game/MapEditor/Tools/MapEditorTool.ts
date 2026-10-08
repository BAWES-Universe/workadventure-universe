import type { EditMapCommandMessage } from "@workadventure/messages";
import type { GameMapFrontWrapper } from "../../GameMap/GameMapFrontWrapper";

export abstract class MapEditorTool {
    public abstract update(time: number, dt: number): void;
    public abstract clear(): void;
    public abstract activate(): void;
    public abstract destroy(): void;
    public abstract subscribeToGameMapFrontWrapperEvents(gameMapFrontWrapper: GameMapFrontWrapper): void;
    public abstract handleKeyDownEvent(event: KeyboardEvent): void;
    /** Whether a pointer that went down on the empty map may drag the camera around (false while the tool needs that drag). */
    public canDragToLookAround(pointer: Phaser.Input.Pointer): boolean {
        return true;
    }
    /**
     * React on commands coming from the outside
     */
    public abstract handleIncomingCommandMessage(editMapCommandMessage: EditMapCommandMessage): Promise<void>;
}
