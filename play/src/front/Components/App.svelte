<script lang="ts">
    /* eslint no-undef: 0 */
    import { onDestroy, onMount } from "svelte";
    import * as Sentry from "@sentry/svelte";
    import WebFontLoaderPlugin from "phaser3-rex-plugins/plugins/webfontloader-plugin.js";
    import AwaitLoaderPlugin from "phaser3-rex-plugins/plugins/awaitloader-plugin.js";
    import OutlinePipelinePlugin from "phaser3-rex-plugins/plugins/outlinepipeline-plugin.js";
    import { derived, type Unsubscriber } from "svelte/store";
    import { DEBUG_MODE, RELEASE_VERSION, SENTRY_DSN_FRONT, SENTRY_ENVIRONMENT } from "../Enum/EnvironmentVariable";
    import { HdpiManager } from "../Phaser/Services/HdpiManager";
    import { EntryScene } from "../Phaser/Login/EntryScene";
    import { LoginScene } from "../Phaser/Login/LoginScene";
    import { SelectCharacterScene } from "../Phaser/Login/SelectCharacterScene";
    import { SelectCompanionScene } from "../Phaser/Login/SelectCompanionScene";
    import { EnableCameraScene } from "../Phaser/Login/EnableCameraScene";
    import { ReconnectingScene } from "../Phaser/Reconnecting/ReconnectingScene";
    import { ErrorScene } from "../Phaser/Reconnecting/ErrorScene";
    import { Game } from "../Phaser/Game/Game";
    import { waScaleManager } from "../Phaser/Services/WaScaleManager";
    import { HtmlUtils } from "../WebRtc/HtmlUtils";
    import { iframeListener } from "../Api/IframeListener";
    import { desktopApi } from "../Api/Desktop";
    import {
        canvasSize,
        coWebsiteManager,
        coWebsites,
        fullScreenCowebsite,
        openHereFloatsStore,
    } from "../Stores/CoWebsiteStore";
    import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
    import { softReconnect } from "../Connection/SoftReconnect";
    import { urlManager } from "../Url/UrlManager";
    import { FileListener } from "../Phaser/FileUpload/FileListener";
    import { isStructuredCloneSupported } from "../Utils/BrowserCompatibility";
    import { bootSplashView, watchLoadingScreen } from "../Utils/BootSplash";
    import { loadingProgressStore } from "../Stores/LoaderStore";
    import { loginSceneVisibleStore } from "../Stores/LoginSceneStore";
    import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
    import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
    import { enableCameraSceneVisibilityStore } from "../Stores/MediaStore";
    import { errorScreenStore } from "../Stores/ErrorScreenStore";
    import { errorStore } from "../Stores/ErrorStore";
    import { wokaRefusedStore } from "../Stores/WokaRefusedStore";
    import { refreshPromptStore } from "../Stores/RefreshPromptStore";
    import BrowserNotSupported from "./BrowserNotSupported/BrowserNotSupported.svelte";
    import OpenHereWindow from "./EmbedScreens/OpenHereWindow.svelte";
    import ClosedItemsToast from "./EmbedScreens/ClosedItemsToast.svelte";
    import GameOverlay from "./GameOverlay.svelte";

    let WebGLRenderer = Phaser.Renderer.WebGL.WebGLRenderer;
    let game: Game;
    let gameDiv: HTMLDivElement;
    let activeCowebsite = $coWebsites[0];
    let gameContainer: HTMLDivElement;
    let canvas: HTMLCanvasElement;
    let handleCanvasClick: () => void;
    let browserNotSupported = false;

    // The one loading screen from index.html (#949, #981) covers the black canvas until the game is up, once the room
    // is joined, and steps aside for any screen that comes instead of the game.
    const otherScreenShownStore = derived(
        [
            loginSceneVisibleStore,
            selectCharacterSceneVisibleStore,
            selectCompanionSceneVisibleStore,
            enableCameraSceneVisibilityStore,
            errorScreenStore,
            errorStore,
            wokaRefusedStore,
            refreshPromptStore,
        ],
        ([login, selectCharacter, selectCompanion, enableCamera, errorScreen, errors, wokaRefused, refresh]) =>
            login ||
            selectCharacter ||
            selectCompanion ||
            enableCamera ||
            errorScreen !== undefined ||
            errors.length > 0 ||
            wokaRefused !== undefined ||
            refresh !== undefined
    );
    // The room kept on screen while the game gets back in (#958) counts as up: its pill says what is going on.
    const gameShownStore = derived(
        [gameSceneIsLoadedStore, softReconnect],
        ([loaded, reconnect]) => loaded || reconnect?.picture !== undefined
    );
    const loadingScreen = bootSplashView();
    const stopWatchingLoadingScreen = watchLoadingScreen(
        { gameLoaded: gameShownStore, otherScreenShown: otherScreenShownStore, progress: loadingProgressStore },
        loadingScreen
    );

    onMount(() => {
        // Check browser compatibility before initializing the app
        if (!isStructuredCloneSupported()) {
            browserNotSupported = true;
            stopWatchingLoadingScreen();
            loadingScreen.hide();
            return;
        }
        if (SENTRY_DSN_FRONT != undefined) {
            try {
                const sentryOptions: Sentry.BrowserOptions = {
                    dsn: SENTRY_DSN_FRONT,
                    release: RELEASE_VERSION,
                    environment: SENTRY_ENVIRONMENT,
                    // Keep Sentry's default integrations except browserApiErrors: it wraps every
                    // setTimeout, setInterval, requestAnimationFrame, addEventListener and XHR callback,
                    // which is a steady main-thread cost in a game. Uncaught errors in those callbacks
                    // are still reported by the globalHandlers integration (window.onerror / unhandledrejection).
                    integrations: (defaultIntegrations) => [
                        ...defaultIntegrations.filter((integration) => integration.name !== "BrowserApiErrors"),
                        Sentry.browserTracingIntegration(),
                    ],
                    // Set tracesSampleRate to 1.0 to capture 100%
                    // of transactions for performance monitoring.
                    // We recommend adjusting this value in production
                    tracesSampleRate: 0.2,
                    attachStacktrace: true,
                };

                Sentry.init(sentryOptions);
                console.info("Sentry initialized");
            } catch (e) {
                console.error("Error while initializing Sentry", e);
            }
        }

        const { width, height } = coWebsiteManager.getGameSize();
        const fps: Phaser.Types.Core.FPSConfig = {
            /**
             * The minimum acceptable rendering rate, in frames per second.
             */
            min: 60,
            /**
             * The optimum rendering rate, in frames per second.
             */
            target: 60,
            /**
             * Use setTimeout instead of requestAnimationFrame to run the game loop.
             */
            forceSetTimeOut: false,
            /**
             * Calculate the average frame delta from this many consecutive frame intervals.
             */
            deltaHistory: 120,
            /**
             * The amount of frames the time step counts before we trust the delta values again.
             */
            panicMax: 20,
            /**
             * Apply delta smoothing during the game update to help avoid spikes?
             */
            smoothStep: false,
        };

        // the ?phaserMode=canvas parameter can be used to force Canvas usage
        const params = new URLSearchParams(document.location.search.substring(1));
        let phaserMode: string | null | undefined = params.get("phaserMode");

        if (phaserMode === null) {
            phaserMode = urlManager.getHashParameter("phaserMode");
        }

        let mode: number;
        switch (phaserMode) {
            case "auto":
            case undefined:
                mode = Phaser.AUTO;
                break;
            case "canvas":
                mode = Phaser.CANVAS;
                break;
            case "webgl":
                mode = Phaser.WEBGL;
                break;
            case "headless":
                mode = Phaser.HEADLESS;
                break;
            default:
                throw new Error('phaserMode parameter must be one of "auto", "canvas", "webgl" or "headless"');
        }

        const hdpiManager = new HdpiManager(640 * 480, 196 * 196);
        const { game: gameSize, real: realSize } = hdpiManager.getOptimalGameSize({ width, height });

        const config: Phaser.Types.Core.GameConfig = {
            type: mode,
            title: "WorkAdventure",
            scale: {
                parent: gameDiv,
                width: gameSize.width,
                height: gameSize.height,
                zoom: realSize.width / gameSize.width,
                autoRound: true,
                resizeInterval: 999999999999,
            },
            scene: [
                EntryScene,
                LoginScene,
                SelectCharacterScene,
                SelectCompanionScene,
                EnableCameraScene,
                ReconnectingScene,
                ErrorScene,
            ],
            //resolution: window.devicePixelRatio / 2,
            fps: fps,
            dom: {
                createContainer: true,
            },
            disableContextMenu: true,
            render: {
                pixelArt: false,
                roundPixels: false,
                antialias: false,
                antialiasGL: false,
            },
            plugins: {
                global: [
                    {
                        key: "rexWebFontLoader",
                        plugin: WebFontLoaderPlugin,
                        start: true,
                    },
                    {
                        key: "rexAwaitLoader",
                        plugin: AwaitLoaderPlugin,
                        start: true,
                    },
                ],
            },
            physics: {
                default: "arcade",
                arcade: {
                    debug: DEBUG_MODE,
                },
            },
            // Instruct systems with 2 GPU to choose the low power one. We don't need that extra power and we want to save battery
            powerPreference: "low-power",
            callbacks: {
                postBoot: (game) => {
                    // Install rexOutlinePipeline only if the renderer is WebGL.
                    const renderer = game.renderer;
                    if (renderer instanceof WebGLRenderer) {
                        game.plugins.install("rexOutlinePipeline", OutlinePipelinePlugin, true);
                    }
                },
            },
            backgroundColor: "#000000",
        };

        game = new Game(config);

        waScaleManager.setGame(game);

        canvas = HtmlUtils.querySelectorOrFail<HTMLCanvasElement>("#game canvas");

        handleCanvasClick = function () {
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
        };

        if (canvas) {
            canvas.addEventListener("click", handleCanvasClick);

            const fileListener = new FileListener(canvas);
            fileListener.initDomListeners();
        }

        //updateScreenSize();
        iframeListener.init();
        desktopApi.init();
    });

    $: if ($coWebsites.length > 0) {
        activeCowebsite = $coWebsites[0];
    }

    function closeCoWebsiteFullScreen() {
        gameContainer.classList.remove("hidden");
        coWebsites.remove(activeCowebsite);
    }

    $: if ($fullScreenCowebsite && $coWebsites.length < 1) {
        closeCoWebsiteFullScreen();
    }

    //$: $coWebsites.length < 1 ? (flexBasis = undefined) : null;

    let canvasSizeUnsubscriber: Unsubscriber;
    onMount(() => {
        canvasSizeUnsubscriber = canvasSize.subscribe(({ width, height }) => {
            if (width < 1 || height < 1) {
                return;
            }
            waScaleManager.applyNewSize();
            waScaleManager.refreshFocusOnTarget();
        });
    });

    onDestroy(() => {
        stopWatchingLoadingScreen();
        canvasSizeUnsubscriber?.();
        if (canvas && handleCanvasClick) {
            canvas.removeEventListener("click", handleCanvasClick);
        }
    });
</script>

{#if browserNotSupported}
    <BrowserNotSupported />
{:else}
    <ClosedItemsToast />
    <div
        class="h-dvh w-dvw flex landscape:flex-row portrait:flex-col-reverse"
        id="main-container"
        bind:this={gameContainer}
    >
        <div id="game" class="relative" class:game-scene-loaded={$gameSceneIsLoadedStore} bind:this={gameDiv}>
            <GameOverlay {game} />
        </div>
        {#if $coWebsites.length > 0}
            <!-- Files and links open in a window over the game, like Orbit's, or in a sheet from the bottom on an upright
                 phone, like the chat's: the map keeps its size either way. It is one component either way, so turning
                 the phone does not unload what is open (a file, a page, a meeting). -->
            <OpenHereWindow floating={$openHereFloatsStore} />
        {/if}
    </div>
{/if}
