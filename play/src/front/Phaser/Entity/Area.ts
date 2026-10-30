import type { AreaData, AtLeast } from "@workadventure/map-editor";
import { merge } from "lodash";
import { get } from "svelte/store";
import type { GameScene } from "../Game/GameScene";
import { warningMessageStore } from "../../Stores/ErrorStore";
import LL from "../../../i18n/i18n-svelte";
import { gameManager } from "../Game/GameManager";

/**
 * Why the player cannot walk into an area: "Who can enter" keeps them out, the room is locked (#1622) or it is full
 * (#1621). In that order: a room the player may not enter says so, and a locked room says Locked, full or not.
 */
export type AreaBlockReason = "noAccess" | "locked" | "full";

/** How long the "is full" or "is locked" pill stays over the player after they bump into the room. */
const CLOSED_MESSAGE_DURATION = 3000;
/** How long the Owner or an Admin is offered to unlock a locked room they bumped into. */
const UNLOCK_HINT_DURATION = 6000;
const UNLOCK_HINT_ID = "area-unlock";

export class Area extends Phaser.GameObjects.Rectangle {
    private areaCollider: Phaser.Physics.Arcade.Collider | undefined = undefined;
    private areaOverlap: Phaser.Physics.Arcade.Collider | undefined = undefined;
    private userHasCollideWithArea = false;
    private highlightTimeOut: undefined | NodeJS.Timeout = undefined;
    private collideTimeOut: undefined | NodeJS.Timeout = undefined;
    private blockReason: AreaBlockReason | undefined;
    private unlockAction: (() => void) | undefined;
    private unlockHintCallback: (() => void) | undefined;

    constructor(
        public readonly scene: GameScene,
        public areaData: AreaData,
        collide?: boolean,
        overlap?: boolean,
        // FIXME: remove this, this is useless
        private connection = gameManager.getCurrentGameScene().connection
    ) {
        super(
            scene,
            areaData.x + areaData.width * 0.5,
            // Because of a limit bug, we add one pixel at the top of the area to be sure the Woka feets don't get into the zone.
            areaData.y + areaData.height * 0.5 - 1,
            areaData.width,
            areaData.height + 1,
            collide ? 0xff0000 : overlap ? 0x0000ff : 0x000000,
            collide || overlap ? 0.1 : 0
        );
        this.blockReason = collide ? "noAccess" : undefined;
        this.scene.add.existing(this).setVisible(false);
        this.scene.physics.add.existing(this, true);
        if (collide) {
            this.applyCollider();
        }
    }

    public getBlockReason(): AreaBlockReason | undefined {
        return this.blockReason;
    }

    /** What "Press Space to unlock" does, for the Owner and Admins at the edge of a locked room. */
    public setUnlockAction(unlockAction: (() => void) | undefined): void {
        this.unlockAction = unlockAction;
        if (unlockAction === undefined) {
            this.removeUnlockHint();
        }
    }

    /**
     * Stops the player at the area's edge, or lets them in again. Only changes the collider and its colour: the area's
     * shape is updated by updateArea.
     */
    public setBlockReason(blockReason: AreaBlockReason | undefined): void {
        this.blockReason = blockReason;
        if (blockReason !== undefined) {
            this.setFillStyle(0xff0000, 0.1);
            this.applyCollider();
        } else {
            this.setFillStyle(0x000000, 0);
            this.areaCollider?.destroy();
            this.areaCollider = undefined;
        }
    }

    public updateArea(newAreaData: AtLeast<AreaData, "id">, blockReason?: AreaBlockReason) {
        merge(this.areaData, newAreaData);
        // Because of a limit bug, we add one pixel at the top of the area to be sure the Woka feets don't get into the zone.
        this.setPosition(this.areaData.x + this.areaData.width * 0.5, this.areaData.y + this.areaData.height * 0.5 - 1);
        this.setSize(this.areaData.width, this.areaData.height + 1);
        this.updateDisplayOrigin();
        this.update();
        const areaStaticBody = this.body as Phaser.Physics.Arcade.StaticBody;
        areaStaticBody.updateFromGameObject();

        this.blockReason = blockReason;
        if (blockReason !== undefined) {
            this.applyCollider();
        } else if (this.areaCollider !== undefined) {
            this.areaCollider.destroy();
            this.areaCollider = undefined;
        } else if (this.areaOverlap !== undefined) this.areaOverlap.destroy();
        this.areaOverlap = undefined;
    }

    destroy(fromScene?: boolean) {
        this.removeUnlockHint();
        super.destroy(fromScene);

        if (this.highlightTimeOut !== undefined) {
            clearTimeout(this.highlightTimeOut);
        }
        if (this.collideTimeOut !== undefined) {
            clearTimeout(this.collideTimeOut);
        }
    }

    private applyCollider() {
        if (this.areaCollider === undefined) {
            this.areaCollider = this.scene.physics.add.collider(this.scene.CurrentPlayer, this, () =>
                this.onCollideAction()
            );
        }
    }

    public highLightArea(permanent = false) {
        this.setVisible(true);
        if (permanent === false) this.highlightTimeOut = setTimeout(() => this.setVisible(false), 1000);
    }

    public unHighLightArea() {
        this.setVisible(false);
        if (this.highlightTimeOut) clearTimeout(this.highlightTimeOut);
    }

    /**
     * The room flashes and a pill over the player says it is locked or full: when they bump into it, or when a teleport
     * or "walk to" would have put them inside. The Owner and Admins at a locked room are offered to unlock it.
     */
    public showClosedMessage(reason: "locked" | "full" = this.blockReason === "locked" ? "locked" : "full"): void {
        this.highLightArea();
        const area = get(LL).area;
        // "The Lounge is full right now": a room named "The Lounge" does not get a second "The".
        const name = this.areaData.name.trim().replace(/^the\s+/i, "");
        if (reason === "locked" && this.unlockAction !== undefined) {
            this.showUnlockHint(name !== "" ? area.unlockHint({ name }) : area.unlockHintUnnamed());
            return;
        }
        const text =
            reason === "locked"
                ? name !== ""
                    ? area.locked({ name })
                    : area.lockedUnnamed()
                : name !== ""
                ? area.full({ name })
                : area.fullUnnamed();
        this.scene.CurrentPlayer.playText("area-closed", text, CLOSED_MESSAGE_DURATION);
    }

    private showUnlockHint(text: string): void {
        this.removeUnlockHint();
        const callback = () => {
            this.removeUnlockHint();
            this.unlockAction?.();
        };
        this.unlockHintCallback = callback;
        this.scene.userInputManager?.addSpaceEventListener(callback);
        this.scene.CurrentPlayer.playText(UNLOCK_HINT_ID, text, UNLOCK_HINT_DURATION, callback);
        // The hint goes by itself: Space stops unlocking with it.
        setTimeout(() => {
            if (this.unlockHintCallback === callback) this.removeUnlockHint();
        }, UNLOCK_HINT_DURATION);
    }

    private removeUnlockHint(): void {
        if (this.unlockHintCallback === undefined) {
            return;
        }
        this.scene.userInputManager?.removeSpaceEventListener(this.unlockHintCallback);
        this.unlockHintCallback = undefined;
        this.scene.CurrentPlayer?.destroyText(UNLOCK_HINT_ID);
    }

    private onCollideAction() {
        if (!this.userHasCollideWithArea) {
            this.userHasCollideWithArea = true;
            if (this.blockReason === "full" || this.blockReason === "locked") {
                this.showClosedMessage(this.blockReason);
            } else {
                this.highLightArea();
                warningMessageStore.addWarningMessage(get(LL).area.noAccess());
            }
            this.collideTimeOut = setTimeout(() => (this.userHasCollideWithArea = false), 3000);
        }
    }
}
