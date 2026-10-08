<script lang="ts">
    import type { Game } from "../../Phaser/Game/Game";
    import type { LoginScene } from "../../Phaser/Login/LoginScene";
    import { LoginSceneName } from "../../Phaser/Login/LoginScene";
    import { MAX_USERNAME_LENGTH } from "../../Enum/EnvironmentVariable";
    import logoImg from "../images/logo.svg";
    import poweredByWorkAdventureImg from "../images/Powered_By_WorkAdventure_Big.png";
    import bgMap from "../images/map-exemple.png";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { joinDesktopStore } from "../../Stores/JoinDesktopStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { NameNotValidError, NameTooLongError } from "../../Exception/NameError";
    import JoinLegal from "../Join/JoinLegal.svelte";
    import MyWoka from "../Join/MyWoka.svelte";
    import { IconAlertTriangle, IconX } from "@wa-icons";

    export let game: Game;

    const loginScene = game.scene.getScene(LoginSceneName) as LoginScene;
    // Opened from the menu, the room is waiting: the screen can lead back into it without a change.
    const canGoBack = gameManager.canResumeGame;

    let name = gameManager.getPlayerName() || "";
    let startValidating = false;
    let errorName = "";

    let logo = gameManager.currentStartedRoom.loginSceneLogo ?? logoImg;

    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage ?? bgMap;

    $: isDesktop = $joinDesktopStore;
    $: wokaSize = isDesktop ? 72 : 64;
    $: spotSize = isDesktop ? 128 : 112;

    async function submit() {
        startValidating = true;

        let finalName = name.trim();
        if (finalName !== "") {
            try {
                await loginScene.login(finalName);
            } catch (err) {
                if (err instanceof NameTooLongError) {
                    errorName = $LL.login.input.name.tooLongError();
                } else if (err instanceof NameNotValidError) {
                    errorName = $LL.login.input.name.notValidError();
                } else {
                    errorName = $LL.login.genericError();
                    throw err;
                }
            }
        }
    }

    $: showError = (name.trim() === "" && startValidating) || errorName !== "";
</script>

<div class="absolute left-0 top-0 w-full h-full bg-cover z-10" style="background-image: url('{sceneBg}');" />
<div class="absolute left-0 top-0 w-full h-full z-20 login-overlay" />

<form
    autocomplete="off"
    class="loginScene min-h-dvh flex flex-col items-center justify-start md:justify-center pointer-events-auto relative z-30 px-4 pt-[60px] pb-6 md:p-6"
    on:submit|preventDefault={submit}
>
    <div class="u-join-card w-full md:w-[440px] px-5 py-6 md:p-7">
        {#if canGoBack}
            <button
                type="button"
                class="u-close u-join-x loginSceneBack"
                data-testid="loginSceneBack"
                aria-label={$LL.login.close()}
                title={$LL.login.close()}
                on:click={() => loginScene.back()}
            >
                <IconX font-size="20" />
            </button>
        {/if}

        <div class="grid gap-3.5">
            <img
                draggable="false"
                src={logo}
                alt="logo"
                class="main-logo block mx-auto {gameManager.currentStartedRoom.loginSceneLogo
                    ? 'max-h-[120px] object-contain'
                    : ''}"
                style="width: {isDesktop ? 170 : 150}px;"
            />

            <!-- Your WOKA -->
            <div class="grid justify-items-center mt-1 mb-1.5" aria-hidden="true">
                <div class="u-join-spot name-spot" style="width: {spotSize}px; height: {spotSize}px;">
                    <span class="name-woka"><MyWoka size={wokaSize} /></span>
                </div>
            </div>

            <div class="grid gap-1 text-center">
                <span class="u-eyebrow justify-center">{$LL.login.eyebrow()}</span>
                <h2 class="u-join-title">{$LL.login.heading()}</h2>
            </div>

            <div class="grid gap-1.5">
                <div class="u-join-field name-field" class:u-join-field-error={showError}>
                    <!-- svelte-ignore a11y-autofocus -->
                    <input
                        type="text"
                        name="display-name"
                        autocomplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                        data-bwignore
                        data-form-type="other"
                        data-testid="loginSceneNameInput"
                        placeholder={$LL.login.input.name.placeholder()}
                        aria-label={$LL.login.input.name.placeholder()}
                        aria-invalid={showError}
                        autofocus
                        maxlength={MAX_USERNAME_LENGTH}
                        bind:value={name}
                        on:keypress={() => {
                            startValidating = true;
                        }}
                        on:input={() => (errorName = "")}
                    />
                    <span class="name-count">{name.length}/{MAX_USERNAME_LENGTH}</span>
                </div>
                {#if showError}
                    <p class="err u-join-error">
                        <IconAlertTriangle font-size="16" class="flex-none" />
                        {#if errorName}{errorName}{:else}{$LL.login.input.name.empty()}{/if}
                    </p>
                {:else}
                    <p class="u-join-hint">{$LL.login.hint()}</p>
                {/if}
            </div>

            <button type="submit" disabled={showError} class="u-join-btn u-cta w-full loginSceneFormSubmit"
                >{$LL.login.continue()}</button
            >

            <JoinLegal classList="text-center" />
        </div>
    </div>
    {#if logo !== logoImg && gameManager.currentStartedRoom.showPoweredBy !== false}
        <section class="text-right flex powered-by justify-center items-end mt-4">
            <img draggable="false" src={poweredByWorkAdventureImg} alt="Powered by WorkAdventure" class="h-14" />
        </section>
    {/if}
</form>

<style lang="scss">
    .login-overlay {
        background: radial-gradient(ellipse at 50% 30%, rgb(20 18 30 / 0.7), rgb(10 8 20 / 0.88));
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    }
    .name-spot::after {
        content: "";
        position: absolute;
        left: 24%;
        right: 24%;
        bottom: 20%;
        height: 10px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.45);
        filter: blur(3px);
    }
    .name-woka {
        position: relative;
        z-index: 1;
        display: block;
        margin-bottom: 6%;
        line-height: 0;
    }
    .name-field {
        height: 3.25rem;
        padding: 0 1rem;
    }
    .name-field input {
        font-size: 1.125rem;
        font-weight: 500;
    }
    .name-field input::placeholder {
        color: rgba(255, 255, 255, 0.4);
    }
    .name-count {
        flex: none;
        font-size: 13px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.5);
    }
</style>
