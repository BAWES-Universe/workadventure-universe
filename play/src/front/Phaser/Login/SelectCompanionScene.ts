import type { CompanionTextureCollection } from "@workadventure/messages";
import { Loader } from "../Components/Loader";
import { gameManager } from "../Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import { companionCollectionsStore, selectCompanionSceneVisibleStore } from "../../Stores/SelectCompanionStore";
import { SuperLoaderPlugin } from "../Services/SuperLoaderPlugin";
import { companionListMetakey, CompanionTexturesLoadingManager } from "../Companion/CompanionTexturesLoadingManager";
import { connectionManager } from "../../Connection/ConnectionManager";
import type { SaveResult } from "../../Connection/ConnectionManager";
import { isWokaRefusedShown, refusedPickerStore } from "../../Stores/WokaRefusedStore";
import { EnableCameraSceneName } from "./EnableCameraScene";
import { ResizableScene } from "./ResizableScene";

export const SelectCompanionSceneName = "SelectCompanionScene";

/**
 * The companion screen. This scene only fetches the companion catalog and saves the choice: the screen itself
 * (the little room, the tiles) is SelectCompanionScene.svelte.
 */
export class SelectCompanionScene extends ResizableScene {
    private loader: Loader;
    protected superLoad: SuperLoaderPlugin;

    constructor() {
        super({
            key: SelectCompanionSceneName,
        });
        this.loader = new Loader(this);
        this.superLoad = new SuperLoaderPlugin(this);
    }

    preload() {
        this.cache.json.remove(companionListMetakey());
        companionCollectionsStore.set(undefined);

        const companionLoadingManager = new CompanionTexturesLoadingManager(this.superLoad, this.load);

        companionLoadingManager.loadTextures((collections: CompanionTextureCollection[]) => {
            companionCollectionsStore.set(collections.filter((collection) => collection.textures.length > 0));
            // After a refused join the popup asks first; its "Choose another" opens the picker
            if (!isWokaRefusedShown()) selectCompanionSceneVisibleStore.set(true);
        });
        this.loader.addLoader();
    }

    create() {
        if (gameManager.currentStartedRoom.backgroundColor != undefined) {
            this.cameras.main.setBackgroundColor(gameManager.currentStartedRoom.backgroundColor);
        }
    }

    /**
     * Saves first and only then changes the companion and leaves: when the save fails or is refused, the screen stays
     * open (the caller says why) and the companion you have is unchanged.
     */
    public async selectCompanion(companionId: string): Promise<SaveResult> {
        const result = await connectionManager.saveCompanionTexture(companionId);
        if (result !== "saved") return result;
        localUserStore.setCompanionTextureId(companionId);
        gameManager.setCompanionTextureId(companionId);

        this.closeScene();
        return result;
    }

    public async noCompagnion(): Promise<SaveResult> {
        const result = await connectionManager.saveCompanionTexture(null);
        if (result !== "saved") return result;
        localUserStore.setCompanionTextureId(null);
        gameManager.setCompanionTextureId(null);

        this.closeScene();
        return result;
    }

    public closeScene() {
        refusedPickerStore.set(undefined);
        // next scene
        this.scene.stop(SelectCompanionSceneName);
        gameManager.tryResumingGame(EnableCameraSceneName);
        this.scene.remove(SelectCompanionSceneName);
        selectCompanionSceneVisibleStore.set(false);
    }

    public onResize(): void {}
}
