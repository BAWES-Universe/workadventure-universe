import type { CompanionTextureCollection } from "@workadventure/messages";
import { Loader } from "../Components/Loader";
import { gameManager } from "../Game/GameManager";
import { localUserStore } from "../../Connection/LocalUserStore";
import { selectCompanionSceneVisibleStore } from "../../Stores/SelectCompanionStore";
import { SuperLoaderPlugin } from "../Services/SuperLoaderPlugin";
import { companionListMetakey, CompanionTexturesLoadingManager } from "../Companion/CompanionTexturesLoadingManager";
import { connectionManager } from "../../Connection/ConnectionManager";
import { EnableCameraSceneName } from "./EnableCameraScene";
import { ResizableScene } from "./ResizableScene";

export const SelectCompanionSceneName = "SelectCompanionScene";

/**
 * The companion screen. This scene only fetches the companion catalog and saves the choice: the screen itself
 * (the little room, the tiles) is SelectCompanionScene.svelte.
 */
export class SelectCompanionScene extends ResizableScene {
    /** The room's companion catalog, by collection, once loaded */
    public collections: CompanionTextureCollection[] = [];
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

        const companionLoadingManager = new CompanionTexturesLoadingManager(this.superLoad, this.load);

        companionLoadingManager.loadTextures((collections: CompanionTextureCollection[]) => {
            this.collections = collections.filter((collection) => collection.textures.length > 0);
            selectCompanionSceneVisibleStore.set(true);
        });
        this.loader.addLoader();
    }

    create() {
        if (gameManager.currentStartedRoom.backgroundColor != undefined) {
            this.cameras.main.setBackgroundColor(gameManager.currentStartedRoom.backgroundColor);
        }
    }

    /** The companion you have now, so the screen opens on it (it used to be cleared on open). */
    public get currentCompanionId(): string | null {
        return localUserStore.getCompanionTextureId();
    }

    public async selectCompanion(companionId: string): Promise<void> {
        localUserStore.setCompanionTextureId(companionId);
        gameManager.setCompanionTextureId(companionId);
        await connectionManager.saveCompanionTexture(companionId);

        this.closeScene();
    }

    public async noCompagnion(): Promise<void> {
        localUserStore.setCompanionTextureId(null);
        gameManager.setCompanionTextureId(null);
        await connectionManager.saveCompanionTexture(null);

        this.closeScene();
    }

    public closeScene() {
        // next scene
        this.scene.stop(SelectCompanionSceneName);
        gameManager.tryResumingGame(EnableCameraSceneName);
        this.scene.remove(SelectCompanionSceneName);
        selectCompanionSceneVisibleStore.set(false);
    }

    public onResize(): void {}
}
