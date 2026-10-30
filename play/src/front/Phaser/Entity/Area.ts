import type { AreaData, AtLeast } from "@workadventure/map-editor";
import { merge } from "lodash";
import { get } from "svelte/store";
import type { GameScene } from "../Game/GameScene";
import { warningMessageStore } from "../../Stores/ErrorStore";
import LL from "../../../i18n/i18n-svelte";
import { gameManager } from "../Game/GameManager";

/**
 * Why the player cannot walk into an area: "Who can enter" keeps them out, or the room is full (#1621). "Who can
 * enter" wins: a room the player may not enter says so, full or not.
 */
export type AreaBlockReason = "noAccess" | "full";

/** How long the "is full" pill stays over the player after they bump into a full room. */
const FULL_MESSAGE_DURATION = 3000;

export class Area extends Phaser.GameObjects.Rectangle {
    private areaCollider: Phaser.Physics.Arcade.Collider | undefined = undefined;
    private areaOverlap: Phaser.Physics.Arcade.Collider | undefined = undefined;
    private userHasCollideWithArea = false;
    private highlightTimeOut: undefined | NodeJS.Timeout = undefined;
    private collideTimeOut: undefined | NodeJS.Timeout = undefined;
    private blockReason: AreaBlockReason | undefined;

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
     * The room flashes and a pill over the player says it is full (#1621): when they bump into it, or when a teleport
     * would have put them inside.
     */
    public showFullMessage(): void {
        this.highLightArea();
        // "The Lounge is full right now": a room named "The Lounge" does not get a second "The".
        const name = this.areaData.name.trim().replace(/^the\s+/i, "");
        this.scene.CurrentPlayer.playText(
            "area-full",
            name !== "" ? get(LL).area.full({ name }) : get(LL).area.fullUnnamed(),
            FULL_MESSAGE_DURATION
        );
    }

    private onCollideAction() {
        if (!this.userHasCollideWithArea) {
            this.userHasCollideWithArea = true;
            if (this.blockReason === "full") {
                this.showFullMessage();
            } else {
                this.highLightArea();
                warningMessageStore.addWarningMessage(get(LL).area.noAccess());
            }
            this.collideTimeOut = setTimeout(() => (this.userHasCollideWithArea = false), 3000);
        }
    }
}
