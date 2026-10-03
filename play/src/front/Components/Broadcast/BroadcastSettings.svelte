<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
    import { WAMSettingsUtils } from "@workadventure/map-editor";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { executeUpdateWAMSettings } from "../../Phaser/Game/MapEditor/Commands/Facades";
    import { broadcastReachInfoStore } from "../../Stores/BroadcastStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { adminDashboardActivatedStore } from "../../Stores/MenuStore";
    import { canOpenOrbit, openAdminModalFromMenu } from "../../external-modules/admin-api";
    import { reachDetail, reachTitle } from "./reach";
    import {
        IconCheck,
        IconChevronRight,
        IconDoor,
        IconRocket,
        IconPlus,
        IconShield,
        IconWorld,
        IconX,
    } from "@wa-icons";

    const dispatch = createEventDispatcher<{ saved: void }>();

    type Who = "admins" | "everyone" | "tags";

    const existing = gameManager.getCurrentGameScene().wamFile?.settings?.megaphone;
    const existingRights = existing?.rights ?? [];
    let who: Who =
        existingRights.length === 0
            ? "everyone"
            : existingRights.length === 1 && existingRights[0] === "admin"
            ? "admins"
            : "tags";
    let tags: string[] = who === "tags" ? [...existingRights] : [];
    let newTag = "";
    let addingTag = false;
    let tagInput: HTMLInputElement | undefined;

    const existingScopes = WAMSettingsUtils.getMegaphoneScopes(
        gameManager.getCurrentGameScene().wamFile?.settings ?? {}
    );
    let roomOn = existingScopes.includes("ROOM");
    let worldOn = existingScopes.includes("WORLD");

    let saving = false;
    let error: string | undefined;

    // Rooms outside Orbit have no world and no universe to reach.
    const roomGroup = gameManager.currentStartedRoom?.group ?? null;
    $: orbitAvailable = $adminDashboardActivatedStore && canOpenOrbit();

    async function showTagInput() {
        addingTag = true;
        await tick();
        tagInput?.focus();
    }

    function addTag() {
        const tag = newTag.trim().toLowerCase();
        if (tag && !tags.includes(tag)) tags = [...tags, tag];
        newTag = "";
        addingTag = false;
        if (tag) error = undefined;
    }

    function removeTag(tag: string) {
        tags = tags.filter((candidate) => candidate !== tag);
    }

    async function save() {
        if (saving) return;
        if (who === "tags" && tags.length === 0) {
            error = $LL.broadcast.config.noTag();
            return;
        }
        const scopes = [roomOn ? "ROOM" : undefined, worldOn ? "WORLD" : undefined].filter(
            (scope): scope is string => scope !== undefined
        );
        const rights = who === "admins" ? ["admin"] : who === "everyone" ? [] : tags;
        saving = true;
        error = undefined;
        try {
            await executeUpdateWAMSettings({
                $case: "updateMegaphoneSettingMessage",
                updateMegaphoneSettingMessage: {
                    enabled: scopes.length > 0,
                    title: existing?.title || "MyMegaphone",
                    scope: scopes[0] ?? existing?.scope ?? "WORLD",
                    rights,
                    scopes: { scopes },
                },
            });
            dispatch("saved");
        } catch (e) {
            console.error(e);
            error = $LL.broadcast.config.saveFailed();
        } finally {
            // eslint-disable-next-line require-atomic-updates
            saving = false;
        }
    }

    onMount(() => menuInputFocusStore.set(true));
    onDestroy(() => menuInputFocusStore.set(false));
</script>

<div class="u-eyebrow">{$LL.broadcast.config.who()}</div>
<div class="flex flex-col gap-1" role="radiogroup" aria-label={$LL.broadcast.config.who()}>
    {#each [["admins", $LL.broadcast.config.adminsOnly()], ["everyone", $LL.broadcast.config.everyone()], ["tags", $LL.broadcast.config.tags()]] as [value, label] (value)}
        <button
            type="button"
            class="u-menu-row"
            class:u-selected={who === value}
            role="radio"
            aria-checked={who === value}
            on:click={() => {
                who = value === "admins" ? "admins" : value === "everyone" ? "everyone" : "tags";
                if (who === "tags" && tags.length === 0) showTagInput().catch((e) => console.error(e));
            }}
            data-testid="broadcast-settings-who-{value}"
        >
            <span class="u-menu-label ps-1">{label}</span>
            {#if who === value}<IconCheck font-size="16" aria-hidden="true" />{/if}
        </button>
    {/each}
</div>
{#if who === "tags"}
    <div class="flex flex-wrap items-center gap-2 px-1">
        {#each tags as tag (tag)}
            <span class="u-chip">
                <IconShield font-size="14" class="text-white/60" aria-hidden="true" />
                {tag}
                <button
                    type="button"
                    class="u-chip-remove"
                    on:click={() => removeTag(tag)}
                    aria-label={$LL.broadcast.config.removeTag({ tag })}
                >
                    <IconX font-size="14" />
                </button>
            </span>
        {/each}
        {#if addingTag}
            <input
                type="text"
                class="u-field !w-32 !py-1.5 !px-3 !text-sm"
                placeholder={$LL.broadcast.config.tagPlaceholder()}
                bind:value={newTag}
                bind:this={tagInput}
                on:keydown={(event) => {
                    if (event.key === "Enter") addTag();
                    if (event.key === "Escape") {
                        newTag = "";
                        addingTag = false;
                    }
                }}
                on:blur={addTag}
                data-testid="broadcast-settings-tag"
            />
        {:else}
            <button type="button" class="u-chip-add" on:click={showTagInput} data-testid="broadcast-settings-add-tag">
                <IconPlus font-size="14" aria-hidden="true" />
                {$LL.broadcast.config.addTag()}
            </button>
        {/if}
    </div>
{/if}

<div class="u-eyebrow mt-1">{$LL.broadcast.config.reach()}</div>
<div class="flex flex-col">
    <div class="u-menu-row cursor-default hover:bg-transparent">
        <span class="u-menu-tile" aria-hidden="true"><IconDoor /></span>
        <span class="u-menu-label !whitespace-normal leading-tight">
            <span class="block">{reachTitle($LL, "ROOM")}</span>
            <span class="block text-xs text-white/60">{$broadcastReachInfoStore.roomName}</span>
        </span>
        <button
            type="button"
            class="u-switch"
            role="switch"
            aria-checked={roomOn}
            aria-label={reachTitle($LL, "ROOM")}
            on:click={() => (roomOn = !roomOn)}
            data-testid="broadcast-settings-reach-ROOM"
        />
    </div>
    {#if roomGroup !== null}
        <div class="u-menu-row cursor-default hover:bg-transparent">
            <span class="u-menu-tile" aria-hidden="true"><IconWorld /></span>
            <span class="u-menu-label !whitespace-normal leading-tight">
                <span class="block">{reachTitle($LL, "WORLD")}</span>
                <span class="block text-xs text-white/60">{reachDetail($LL, "WORLD", $broadcastReachInfoStore)}</span>
            </span>
            <button
                type="button"
                class="u-switch"
                role="switch"
                aria-checked={worldOn}
                aria-label={reachTitle($LL, "WORLD")}
                on:click={() => (worldOn = !worldOn)}
                data-testid="broadcast-settings-reach-WORLD"
            />
        </div>
        <!-- Universe-wide reach is set in Orbit: the row opens it when Orbit is reachable, else it only says so. -->
        {#if orbitAvailable}
            <button
                type="button"
                class="u-menu-row"
                on:click={() => openAdminModalFromMenu()}
                data-testid="broadcast-settings-reach-UNIVERSE"
            >
                <span class="u-menu-tile" aria-hidden="true"><IconRocket /></span>
                <span class="u-menu-label !whitespace-normal leading-tight">
                    <span class="block">{reachTitle($LL, "UNIVERSE")}</span>
                    <span class="block text-xs text-white/60">
                        {[reachDetail($LL, "UNIVERSE", $broadcastReachInfoStore), $LL.broadcast.config.setInOrbit()]
                            .filter((part) => part)
                            .join(" · ")}
                    </span>
                </span>
                <IconChevronRight font-size="16" class="u-menu-go rtl:-scale-x-100" aria-hidden="true" />
            </button>
        {:else}
            <div class="u-menu-row cursor-default hover:bg-transparent" data-testid="broadcast-settings-reach-UNIVERSE">
                <span class="u-menu-tile" aria-hidden="true"><IconRocket /></span>
                <span class="u-menu-label !whitespace-normal leading-tight">
                    <span class="block">{reachTitle($LL, "UNIVERSE")}</span>
                    <span class="block text-xs text-white/60">
                        {[reachDetail($LL, "UNIVERSE", $broadcastReachInfoStore), $LL.broadcast.config.setInOrbit()]
                            .filter((part) => part)
                            .join(" · ")}
                    </span>
                </span>
            </div>
        {/if}
    {/if}
</div>
<p class="m-0 flex items-center gap-2 text-xs text-white/60">
    <IconShield font-size="16" class="flex-none" aria-hidden="true" />
    {$LL.broadcast.config.rolesLater()}
</p>
{#if error}
    <div class="u-error-line" role="alert">
        <span class="flex-1">{error}</span>
        <button
            type="button"
            class="u-chip-remove"
            on:click={() => (error = undefined)}
            aria-label={$LL.broadcast.close()}
        >
            <IconX font-size="14" />
        </button>
    </div>
{/if}
<button
    type="button"
    class="u-cta rounded-full w-full py-3.5 text-base font-bold"
    disabled={saving}
    on:click={save}
    data-testid="broadcast-settings-save"
>
    {$LL.broadcast.config.save()}
</button>
