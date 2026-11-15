<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { fly } from "svelte/transition";
    import { closeAllModals, closeModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { openBrickChat } from "../BrickChat";
    import { keepFocusInside } from "../keepFocusInside";
    import { makeMyBrickFromTemplate } from "../MyBricksStore";
    import { openBrickPage } from "./OpenBrick";
    import { missingNeeds, type TemplatePreview } from "./Template";
    import { readTemplatePreview, setTemplateStar } from "./Templates";
    import { IconBolt, IconCheck, IconLock, IconPlugConnectedX, IconStar, IconStarFilled, IconX } from "@wa-icons";
    import "../BrickGroups.css";
    import "./Templates.css";

    /**
     * A template's look before creating a Brick from it (game #2008, mock Part 20 picture 2): what the new Brick starts
     * with, what stays with the original, and what it still needs. "Setup required" is said here, before anything is made,
     * when the Brick's main job cannot work yet; the person can still create it, knowing what is missing. Star keeps the
     * template for later. Create Brick makes a NEW Brick with its own name and identity: no memory, chat, app, key,
     * sign-in, file, computer or running task comes along.
     */
    export let isOpen: boolean;
    export let templateId: string;

    type Phase = "loading" | "ready" | "failed" | "gone";

    let phase: Phase = "loading";
    let preview: TemplatePreview | undefined;
    let name = "";
    let starred = false;
    let busy = false;
    let starring = false;
    let reading = false;
    // Closed before Orbit answered: the Brick is still made, but this sheet opens and closes nothing more
    let dismissed = false;
    onDestroy(() => (dismissed = true));

    $: t = $LL.chat.brick.templates;
    $: maker = preview?.makerName ?? "";
    $: missing = preview ? missingNeeds(preview.needs) : [];
    $: ready = phase === "ready" && name.trim().length > 0 && !busy;

    async function load() {
        phase = "loading";
        const read = await readTemplatePreview(templateId);
        if (dismissed) return;
        if (!read.ok) {
            phase = read.why;
            return;
        }
        preview = read.value;
        name = read.value.name;
        starred = read.value.starred;
        phase = "ready";
    }

    onMount(() => {
        load().catch((error) => console.error(error));
    });

    async function toggleStar() {
        if (starring || !preview) return;
        starring = true;
        const next = !starred;
        starred = next;
        const saved = await setTemplateStar(templateId, next);
        // eslint-disable-next-line require-atomic-updates
        starring = false;
        if (!saved) {
            // eslint-disable-next-line require-atomic-updates
            starred = !next;
            warningMessageStore.addWarningMessage(t.starFailed());
        }
    }

    async function create() {
        if (!ready) return;
        busy = true;
        try {
            const made = await makeMyBrickFromTemplate(templateId, name.trim());
            if (!made) {
                warningMessageStore.addWarningMessage($LL.chat.brick.makeFailed());
                return;
            }
            if (dismissed || !isOpen) return;
            closeAllModals();
            // Its page when there is something to set up or switched off (that is where it says so); else its chat
            const { used } = made;
            if (used.view?.setup.setupRequired || used.routinesAdded > 0 || used.routinesLeftOut > 0) {
                openBrickPage(made.brick.id);
            } else {
                openBrickChat(made.brick.id).catch((error) => console.error(error));
            }
        } catch (error) {
            console.warn("Could not make a Brick from a template", error);
            if ((error as { status?: number } | null)?.status === 404) {
                phase = "gone";
            } else {
                warningMessageStore.addWarningMessage($LL.chat.brick.makeFailed());
            }
        } finally {
            busy = false;
        }
    }
</script>

{#if isOpen}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="tp-scrim" on:click|self={closeModal}>
        <form
            class="tp-sheet u-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-sheet-title"
            data-testid="templateSheet"
            use:keepFocusInside={closeModal}
            transition:fly={{ y: 16, duration: 200 }}
            on:submit|preventDefault={create}
        >
            <button
                type="button"
                class="u-close absolute top-2 end-2"
                aria-label={$LL.chat.brick.closeCard()}
                data-testid="templateSheetClose"
                on:click={closeModal}
            >
                <IconX font-size="20" />
            </button>
            {#if phase === "ready" && preview}
                <h2 id="template-sheet-title" class="u-display tp-title">{t.previewTitle({ name: preview.name })}</h2>
                <p class="tp-sub">
                    {maker ? t.previewSub({ maker }) : t.previewSubNoMaker()}
                </p>
                <label class="tp-label">
                    <span>{t.nameLabel()}</span>
                    <input
                        class="tp-field"
                        type="text"
                        maxlength="100"
                        bind:value={name}
                        data-testid="templateName"
                        on:focus={(event) => event.currentTarget.select()}
                    />
                </label>

                <div class="bkg-cap gap">{t.startsWith()}</div>
                {#if preview.look || preview.description}
                    <div class="bkg-tap" data-testid="templateStartsLook">
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{t.lookAndPersonality({ name: preview.name })}</span>
                            <span class="bkg-cn">{t.changeAnyTime()}</span>
                        </span>
                    </div>
                {/if}
                {#if preview.instructions}
                    <button
                        type="button"
                        class="bkg-tap"
                        aria-expanded={reading}
                        data-testid="templateReadInstructions"
                        on:click={() => (reading = !reading)}
                    >
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{t.instructions()}</span>
                            <span class="bkg-cn">{maker ? t.instructionsBy({ maker }) : t.instructionsNoMaker()}</span>
                        </span>
                    </button>
                    {#if reading}
                        <p class="tp-read" data-testid="templateInstructions">{preview.instructions}</p>
                    {/if}
                {/if}
                {#if preview.firstThing}
                    <div class="bkg-tap" data-testid="templateStartsFirst">
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{t.firstThing()}</span>
                            <span class="bkg-cn">“{preview.firstThing}”</span>
                        </span>
                    </div>
                {/if}
                {#if preview.routines.length > 0}
                    <div class="bkg-tap" data-testid="templateStartsRoutines">
                        <span class="bkg-ico"><IconCheck font-size="20" /></span>
                        <span class="bkg-mtx">
                            <span class="bkg-t">{t.routines({ count: preview.routines.length })}</span>
                            <span class="bkg-cn">{t.routinesOff()}</span>
                        </span>
                    </div>
                {/if}

                <div class="bkg-cap gap">{t.staysWith({ name: preview.name })}</div>
                <div class="bkg-tap tp-off" data-testid="templateStays">
                    <span class="bkg-ico"><IconLock font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.staysMemory()}</span>
                        <span class="bkg-cn">{t.staysPeople()}</span>
                    </span>
                </div>
                <div class="bkg-tap tp-off">
                    <span class="bkg-ico"><IconLock font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{maker ? t.staysAppsBy({ maker }) : t.staysApps()}</span>
                        <span class="bkg-cn">{t.staysFiles()}</span>
                    </span>
                </div>

                {#if missing.length > 0}
                    <div class="bkg-cap gap" data-testid="templateSetup">{t.setupRequired()}</div>
                    {#each missing as need (need.key)}
                        <div class="bkg-tap" data-testid="templateNeed">
                            <span class="bkg-ico tp-warn"><IconPlugConnectedX font-size="20" /></span>
                            <span class="bkg-mtx">
                                <span class="bkg-t"
                                    >{need.kind === "computer"
                                        ? t.needsComputer()
                                        : t.needsApp({ label: need.label })}</span
                                >
                                <span class="bkg-cn"
                                    >{need.kind === "computer" ? t.needsComputerHint() : t.needsAppHint()}</span
                                >
                            </span>
                        </div>
                    {/each}
                {/if}
                <div class="bkg-tap">
                    <span class="bkg-ico"><IconBolt font-size="20" /></span>
                    <span class="bkg-mtx">
                        <span class="bkg-t">{t.repliesUse()}</span>
                        <span class="bkg-cn">{t.repliesUseHint()}</span>
                    </span>
                </div>

                <div class="tp-btns">
                    <PageButton tall testId="templateStar" on:click={toggleStar}>
                        {#if starred}<span class="tp-star-on"><IconStarFilled font-size="18" /></span
                            >{t.starred()}{:else}<IconStar font-size="18" />{t.star()}{/if}
                    </PageButton>
                    <span class="tp-first" />
                    <PageButton tall testId="templateCancel" on:click={closeModal}
                        >{$LL.mapEditor.edit.bots.page.create.cancel()}</PageButton
                    >
                    <button type="submit" class="tp-go" disabled={!ready} data-testid="templateCreate">
                        {t.create()}
                    </button>
                </div>
            {:else}
                <h2 id="template-sheet-title" class="u-display tp-title">{t.previewTitleNone()}</h2>
                {#if phase === "loading"}
                    <p class="tp-sub" data-testid="templateLoading">{$LL.chat.brick.loading()}</p>
                {:else if phase === "gone"}
                    <p class="tp-bad" data-testid="templateGone">{t.gone()}</p>
                    <div class="tp-btns">
                        <PageButton tall go testId="templateGoneDone" on:click={closeModal}>{t.close()}</PageButton>
                    </div>
                {:else}
                    <p class="tp-bad" data-testid="templateFailed">{t.loadFailed()}</p>
                    <div class="tp-btns">
                        <PageButton tall testId="templateRetry" on:click={load}>{$LL.chat.brick.tryAgain()}</PageButton>
                    </div>
                {/if}
            {/if}
        </form>
    </div>
{/if}

<style>
    .tp-go {
        height: 44px;
        margin: 0;
        padding: 0 20px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .tp-go:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .tp-go:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
