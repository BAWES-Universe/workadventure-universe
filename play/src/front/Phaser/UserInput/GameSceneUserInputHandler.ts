import { get } from "svelte/store";
import * as Sentry from "@sentry/svelte";
import { Player } from "../Player/Player";
import { RemotePlayer } from "../Entity/RemotePlayer";
import type { UserInputHandlerInterface } from "../../Interfaces/UserInputHandlerInterface";
import type { GameScene } from "../Game/GameScene";
import { mapEditorModeStore, mapEditorToolbarInUseStore } from "../../Stores/MapEditorStore";
import { isActivatable } from "../Game/ActivatableInterface";
import { toggleMyCard } from "../../Chat/Components/UserList/PersonNavigation";
import { localUserStore } from "../../Connection/LocalUserStore";
import { mapManagerActivated } from "../../Stores/MenuStore";
import { displayEmote, isEmoteIndex } from "../../Stores/EmoteStore";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { navChat } from "../../Chat/Stores/ChatStore";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { openChat } from "../../Chat/openChat";
import { expressTrayStore } from "../../Stores/ExpressStore";
import { isPopupJustClosed } from "../Game/Say/SayManager";
import LL from "../../../i18n/i18n-svelte";
import { botEditorToolActiveStore } from "../../external-modules/bots/stores/BotEditorStore";
import { isQuickTap } from "./QuickTap";
import type { Shortcut } from "./UserInputManager";

export class GameSceneUserInputHandler implements UserInputHandlerInterface {
    private gameScene: GameScene;
    private controlKeyisPressed: boolean = false;
    public shortcuts: Shortcut[] = [];

    constructor(gameScene: GameScene) {
        this.gameScene = gameScene;

        this.initShortcuts();
    }

    public initShortcuts() {
        this.shortcuts = [
            {
                key: "C",
                description: get(LL).menu.shortcuts.openChat(),
            },
            {
                key: "U",
                description: get(LL).menu.shortcuts.openUserList(),
            },
            {
                key: "E",
                description: get(LL).menu.shortcuts.toggleMapEditor(),
            },
            {
                key: "R",
                description: get(LL).menu.shortcuts.rotatePlayer(),
            },
            {
                key: "1",
                description: get(LL).menu.shortcuts.emote1(),
            },
            {
                key: "2",
                description: get(LL).menu.shortcuts.emote2(),
            },
            {
                key: "3",
                description: get(LL).menu.shortcuts.emote3(),
            },
            {
                key: "4",
                description: get(LL).menu.shortcuts.emote4(),
            },
            {
                key: "5",
                description: get(LL).menu.shortcuts.emote5(),
            },
            {
                key: "6",
                description: get(LL).menu.shortcuts.emote6(),
            },
            // Enter
            {
                key: "Enter",
                description: get(LL).menu.shortcuts.openSayPopup(),
            },
            // Ctrl + Enter
            {
                key: "Enter",
                description: get(LL).menu.shortcuts.openThinkPopup(),
                ctrlKey: true,
            },
            // Cmd (Mac) / Ctrl (Windows & Linux) + D
            {
                key: "D",
                description: get(LL).menu.shortcuts.walkMyDesk(),
                ctrlKey: true,
            },
        ];
    }

    public handleMouseWheelEvent(
        pointer: Phaser.Input.Pointer,
        gameObjects: Phaser.GameObjects.GameObject[],
        deltaX: number,
        deltaY: number,
        deltaZ: number
    ): void {
        this.gameScene.handleMouseWheel(deltaY);
    }

    public handlePointerUpEvent(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {
        // While editing the room, a tap on the map is for the editor (place, select, pan): it never walks you there.
        // Looking around is not editing: a tap on someone still opens their card, as it always did.
        if (get(mapEditorToolbarInUseStore)) {
            return;
        }
        if (pointer.wasTouch || pointer.leftButtonReleased()) {
            for (const object of gameObjects) {
                if (isActivatable(object)) {
                    // While the bot editor is open, clicks on the map are for placing and moving bots:
                    // don't open an avatar's card over the editor (your own card is skipped below).
                    if (object instanceof RemotePlayer && get(botEditorToolActiveStore)) {
                        return;
                    }
                    this.gameScene.getActivatablesManager().handlePointerDownEvent(object);
                    return;
                }
            }
            // Your own avatar: a quick tap or click opens your card (a hold or a joystick drag from it doesn't),
            // except while the bot editor is open.
            if (
                !get(botEditorToolActiveStore) &&
                this.gameScene.userInputManager.isControlsEnabled &&
                isQuickTap(pointer) &&
                gameObjects.includes(this.gameScene.CurrentPlayer)
            ) {
                toggleMyCard(localUserStore.getLocalUser()?.uuid);
                return;
            }
        }

        if ((!pointer.wasTouch && pointer.leftButtonReleased()) || pointer.getDuration() > 250) {
            return;
        }

        if (!this.gameScene.userInputManager.isControlsEnabled) {
            return;
        }

        // If right click is disabled, we don't want to move the player
        if (!this.gameScene.userInputManager.isRightClickEnabled) {
            return;
        }

        for (const object of gameObjects) {
            if (object instanceof Player || object instanceof RemotePlayer) {
                return;
            }
        }
        const camera = this.gameScene.getCameraManager().getCamera();
        this.gameScene
            .moveTo(
                {
                    x: pointer.x + camera.scrollX,
                    y: pointer.y + camera.scrollY,
                },
                true
            )
            .catch((reason) => {
                console.warn(reason);
            });
    }

    public handlePointerDownEvent(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {}

    public handlePointerMoveEvent(pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[]): void {}

    private handleKeyC() {
        if (!this.gameScene.room.isChatEnabled) return;

        const isChatVisible = get(chatVisibilityStore);
        const isInMapEditor = get(mapEditorModeStore);
        const currentNav = get(navChat).key;

        if (currentNav === "users" && isChatVisible) {
            navChat.switchToChat();
        } else if (!isChatVisible && !isInMapEditor) {
            navChat.switchToChat();
            openChat("button");
        } else if (isChatVisible) {
            chatVisibilityStore.set(false);
        }
    }
    private handleKeyU() {
        const isChatVisible = get(chatVisibilityStore);
        const isInMapEditor = get(mapEditorModeStore);
        const currentNav = get(navChat).key;
        if (!this.gameScene.room.isChatOnlineListEnabled) return;
        if (currentNav === "chat" && isChatVisible) {
            navChat.switchToUserList();
        } else if (!isChatVisible && !isInMapEditor) {
            navChat.switchToUserList();
            openChat("button");
        } else if (isChatVisible) {
            chatVisibilityStore.set(false);
        }
    }
    public handleKeyDownEvent(event: KeyboardEvent): KeyboardEvent {
        const hasExecutedCommand = this.gameScene.getMapEditorModeManager()?.handleKeyDownEvent(event);
        if (hasExecutedCommand) {
            return event;
        }

        switch (event.code) {
            case "KeyE": {
                if (get(mapManagerActivated) == false) return event;
                mapEditorModeStore.switchMode(!get(mapEditorModeStore));
                break;
            }
            case "KeyR": {
                this.gameScene.CurrentPlayer.rotate();
                break;
            }
            case "KeyC":
                this.handleKeyC();
                break;
            case "KeyU":
                this.handleKeyU();
                break;
            case "KeyD": {
                // Handle Cmd (Mac) / Ctrl (Windows & Linux) + D for "walk my desk"
                if (event.metaKey || event.ctrlKey) {
                    // Prevent the shortcut from being triggered when typing in input fields
                    if (
                        event.target instanceof HTMLInputElement ||
                        event.target instanceof HTMLTextAreaElement ||
                        event.target instanceof HTMLSelectElement
                    ) {
                        return event;
                    }
                    event.preventDefault();
                    this.gameScene.walkToPersonalDesk().catch((error) => {
                        console.warn("Error walking to personal desk", error);
                    });
                }
                break;
            }
            case "Digit1":
            case "Digit2":
            case "Digit3":
            case "Digit4":
            case "Digit5":
            case "Digit6": {
                // Extract the digit from event.code (e.g., "Digit1" -> 1)
                const digit = event.code.replace("Digit", "");
                const emoteIndex = Number.parseInt(digit, 10);

                if (isEmoteIndex(emoteIndex)) {
                    displayEmote(emoteIndex, "keyboard");
                } else {
                    console.warn(`Invalid emote index: ${emoteIndex}`);
                    Sentry.captureException(new Error(`Invalid emote index: ${emoteIndex}`));
                }
                break;
            }
            default: {
                break;
            }
        }

        switch (event.key) {
            case "Control": {
                this.controlKeyisPressed = true;
                break;
            }
            default: {
                break;
            }
        }

        return event;
    }

    /** Enter opens the Express tray ready to type; Ctrl+Enter opens it in Think mode. */
    private openExpress(): void {
        if (!this.gameScene.room.isSayEnabled) {
            return;
        }
        // Don't reopen with the Enter that just sent or closed the tray, nor while it is open.
        if (isPopupJustClosed() || get(expressTrayStore) !== "closed") {
            return;
        }
        const think = this.controlKeyisPressed;
        expressTrayStore.open({ think, focusInput: true });
        analyticsClient.expressTrayOpened("keyboard");
        if (think) {
            analyticsClient.openThinkBubble("keyboard");
        } else {
            analyticsClient.openSayBubble("keyboard");
        }
    }

    public handleKeyUpEvent(event: KeyboardEvent): KeyboardEvent {
        switch (event.key) {
            // SPACE
            case " ": {
                this.handleActivableEntity();
                break;
            }
            case "Control": {
                this.controlKeyisPressed = false;
                break;
            }
            case "Enter": {
                // Enter on a button or link the keyboard focused belongs to that control (it just clicked it), not to Express.
                if (!isFromFocusedControl(event)) {
                    this.openExpress();
                }
                this.controlKeyisPressed = false;
                break;
            }
            default: {
                break;
            }
        }
        return event;
    }

    public handleActivableEntity() {
        const activatableManager = this.gameScene.getActivatablesManager();
        const activatable = activatableManager.getSelectedActivatableObject();
        if (activatable && activatable.isActivatable() && activatableManager.isSelectingByDistanceEnabled()) {
            activatable.activate();
            activatable.destroyText("object");
        }
        this.gameScene.CurrentPlayer.handlePressSpacePlayerTextCallback();
    }

    public addSpaceEventListener(callback: () => void): void {
        this.gameScene.input.keyboard?.addListener("keyup-SPACE", callback);
        this.gameScene.getActivatablesManager().disableSelectingByDistance();
    }
    public removeSpaceEventListener(callback: () => void): void {
        this.gameScene.input.keyboard?.removeListener("keyup-SPACE", callback);
        this.gameScene.getActivatablesManager().enableSelectingByDistance();
    }
}

/**
 * Whether a key event comes from a control on the page (a button, link, field or tab) that the keyboard moved the
 * focus to. A button clicked with the mouse keeps the focus too, but is not :focus-visible, so Enter after a click
 * still opens Express as before.
 */
function isFromFocusedControl(event: KeyboardEvent): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    const control = target.closest(
        "button, a[href], input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='button'], [role='tab'], [role='menuitem'], [role='link']"
    );
    // The Express button is Express's own: the tray hands the focus back to it when it closes, and Enter there still
    // opens Express, Ctrl+Enter in Think mode, as everywhere on the map.
    if (!control || control.hasAttribute("data-opens-express")) return false;
    try {
        return control.matches(":focus-visible");
    } catch {
        // A browser without :focus-visible: treat the control as the keyboard's.
        return true;
    }
}
