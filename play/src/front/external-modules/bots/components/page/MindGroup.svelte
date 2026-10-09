<script lang="ts">
    // Mind: which AI the bot thinks with. A provider whose model has vision (can look at pictures) says so.
    import { onMount } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { BotData } from "../../types";
    import { botApiService } from "../../services/BotApiService";
    import { resolveVisionSupport } from "../../visionModels";
    import PageGroup from "./PageGroup.svelte";
    import PageButton from "./PageButton.svelte";
    import { IconChevronDown, IconSparkles } from "@wa-icons";

    export let bot: BotData;
    export let open: boolean;
    export let onToggle: (id: string) => void;
    export let onChange: (bot: BotData) => void;

    type Provider = Awaited<ReturnType<typeof botApiService.getAvailableAIProviders>>[number];

    let providers: Provider[] = [];
    let loading = true;
    let failed = false;

    async function load() {
        loading = true;
        failed = false;
        if (!botApiService.isInitialized()) {
            loading = false;
            failed = true;
            return;
        }
        try {
            providers = await botApiService.getAvailableAIProviders(true);
        } catch (e) {
            console.error("[MindGroup] Failed to load AI providers:", e);
            failed = true;
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        void load();
    });

    // A provider can see pictures when its model can (by its setting or its model's name), or when it has a
    // separate model for pictures.
    function seesPictures(provider: Provider): boolean {
        return (
            resolveVisionSupport(provider.model || "", provider.supportsVision) ||
            (!!provider.visionModel && provider.supportsVision !== false)
        );
    }

    $: page = $LL.mapEditor.edit.bots.page;
    $: ref = bot.aiProviderRef ?? "";
    $: current = providers.find((p) => p.providerId.toLowerCase() === ref.toLowerCase());
    $: brief = !ref
        ? page.mind.none()
        : current
        ? [
              current.enabled ? current.name : `${current.name} ${$LL.actionbar.botEditorModule.providerDisabled()}`,
              current.model,
              seesPictures(current) ? page.mind.seesPictures() : "",
          ]
              .filter(Boolean)
              .join(" · ")
        : ref;

    function pick(event: Event) {
        const value = (event.currentTarget as HTMLSelectElement).value;
        onChange({ ...bot, aiProviderRef: value || undefined });
    }
</script>

<PageGroup id="mind" icon={IconSparkles} title={page.mind.title()} {brief} {open} {onToggle}>
    {#if loading}
        <p class="bp-m">{$LL.actionbar.botEditorModule.loadingProviders()}</p>
    {:else if failed}
        <div class="bp-line">
            <p class="bp-m">{$LL.actionbar.botEditorModule.errorLoadFailed()}</p>
            <PageButton on:click={() => void load()}>{$LL.actionbar.botEditorModule.retry()}</PageButton>
        </div>
    {:else if providers.length === 0}
        <p class="bp-m">{$LL.actionbar.botEditorModule.noProvidersConfigured()}</p>
    {:else}
        <label class="bp-select">
            <span class="sr-only">{page.mind.title()}</span>
            <select value={current?.providerId ?? ref} on:change={pick} data-testid="bot-mind-provider">
                {#if !current}
                    <option value={ref}>{ref || page.mind.none()}</option>
                {/if}
                {#each providers as provider (provider.providerId)}
                    <option value={provider.providerId}>
                        {provider.name}{seesPictures(provider) ? ` · ${page.mind.seesPictures()}` : ""}{provider.enabled
                            ? ""
                            : ` ${$LL.actionbar.botEditorModule.providerDisabled()}`}
                    </option>
                {/each}
            </select>
            <IconChevronDown font-size="16" />
        </label>
        <p class="bp-m">{page.mind.hint()}</p>
    {/if}
</PageGroup>

<style>
    .bp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-line {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: space-between;
    }
    .bp-select {
        position: relative;
        display: block;
    }
    .bp-select select {
        width: 100%;
        height: 40px;
        margin: 0;
        padding: 0 36px 0 12px;
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 14px;
        color: #fff;
        appearance: none;
        cursor: pointer;
        outline: none;
    }
    .bp-select select:focus-visible {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .bp-select select option {
        background: #14121e;
        color: #fff;
    }
    .bp-select :global(svg) {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(244, 242, 250, 0.64);
        pointer-events: none;
    }
</style>
