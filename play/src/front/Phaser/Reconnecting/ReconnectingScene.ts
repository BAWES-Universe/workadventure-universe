import { get } from "svelte/store";
import { TextField } from "../Components/TextField";
import { LL } from "../../../i18n/i18n-svelte";
import { gameManager } from "../Game/GameManager";

export const ReconnectingSceneName = "ReconnectingScene";
export enum ReconnectingTextures {
    icon = "icon",
    mainFont = "main_font",
}

export class ReconnectingScene extends Phaser.Scene {
    private reconnectingField!: TextField;

    constructor() {
        super({
            key: ReconnectingSceneName,
        });
    }

    preload() {
        // Note: arcade.png from the Phaser 3 examples at: https://github.com/photonstorm/phaser3-examples/tree/master/public/assets/fonts/bitmap
        this.load.bitmapFont(ReconnectingTextures.mainFont, "resources/fonts/arcade.png", "resources/fonts/arcade.xml");
        this.load.spritesheet("cat", "resources/characters/pipoya/Cat 01-1.png", { frameWidth: 32, frameHeight: 32 });
    }

    create() {
        this.reconnectingField = new TextField(
            this,
            this.game.renderer.width / 2,
            this.game.renderer.height / 2,
            get(LL).warning.connectionLost()
        );

        const cat = this.add.sprite(this.game.renderer.width / 2, this.game.renderer.height / 2 - 32, "cat");
        if (!this.anims.exists("right")) {
            this.anims.create({
                key: "right",
                frames: this.anims.generateFrameNumbers("cat", { start: 6, end: 8 }),
                frameRate: 10,
                repeat: -1,
            });
        }
        cat.play("right");

        if (gameManager.currentStartedRoom.backgroundColor != undefined) {
            this.cameras.main.setBackgroundColor(gameManager.currentStartedRoom.backgroundColor);
        }
    }
}
