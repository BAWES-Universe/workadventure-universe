<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { DEFAULT_MEGAPHONE_RIGHTS, MEGAPHONE_SCOPES, WAMSettingsUtils } from "@workadventure/map-editor";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { executeUpdateWAMSettings } from "../../Phaser/Game/MapEditor/Commands/Facades";
    import type { BroadcastReach } from "../../Stores/BroadcastStore";
    import { broadcastReachInfoStore } from "../../Stores/BroadcastStore";
    import { menuInputFocusStore } from "../../Stores/MenuInputFocusStore";
    import { reachDetail, reachTitle } from "./reach";
    import { IconCheck, IconDoor, IconInfoCircle, IconRocket, IconUsers, IconWorld, IconX } from "@wa-icons";

    const dispatch = createEventDispatcher<{ saved: void }>();

    // Who can go live, from narrowest to widest: the roles Orbit gives people in a world (admin, editor, member),
    // or everyone. Each is saved as the tags that may go live; none means everyone.
    type Who = "admins" | "editors" | "members" | "everyone";
    const WHO_RIGHTS: Record<Who, string[]> = {
        admins: ["admin"],
        editors: ["admin", "editor"],
        members: ["admin", "editor", "member"],
        everyone: [],
    };
    const WHO_ORDER: Who[] = ["admins", "editors", "members", "everyone"];

    const settings = gameManager.getCurrentGameScene().wamFile?.settings;
    // A room nobody has set up lets its admins go live.
    const existingRights = settings?.megaphone ? settings.megaphone.rights ?? [] : DEFAULT_MEGAPHONE_RIGHTS;
    // Tags saved by the older settings that match none of the roles leave nothing picked until someone picks.
    let who: Who | undefined = WHO_ORDER.find(
        (candidate) =>
            WHO_RIGHTS[candidate].length === existingRights.length &&
            WHO_RIGHTS[candidate].every((right) => existingRights.includes(right))
    );

    // Rooms outside Orbit have no world and no universe to reach.
    const roomGroup = gameManager.currentStartedRoom?.group ?? null;
    const reaches: BroadcastReach[] = roomGroup !== null ? MEGAPHONE_SCOPES : ["ROOM"];
    const icons = { ROOM: IconDoor, WORLD: IconWorld, UNIVERSE: IconRocket };

    // How far is one pick: the widest reach saved (a room nobody has set up reaches everywhere). A room switched
    // off with the older settings starts at the widest too, which saving turns back on.
    const savedReaches = WAMSettingsUtils.getMegaphoneScopes(settings ?? {}).filter((reach) => reaches.includes(reach));
    let far: BroadcastReach = savedReaches[savedReaches.length - 1] ?? reaches[reaches.length - 1];
    $: farIndex = reaches.indexOf(far);

    let saving = false;
    let error: string | undefined;

    async function save() {
        if (saving) return;
        if (!who) {
            error = $LL.broadcast.config.pickWho();
            return;
        }
        const scopes = reaches.slice(0, farIndex + 1);
        saving = true;
        error = undefined;
        try {
            await executeUpdateWAMSettings({
                $case: "updateMegaphoneSettingMessage",
                updateMegaphoneSettingMessage: {
                    enabled: true,
                    title: settings?.megaphone?.title || "MyMegaphone",
                    scope: scopes[0],
                    rights: WHO_RIGHTS[who],
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

    function whoLabel(candidate: Who): string {
        switch (candidate) {
            case "admins":
                return $LL.broadcast.config.adminsOnly();
            case "editors":
                return $LL.broadcast.config.adminsAndEditors();
            case "members":
                return $LL.broadcast.config.allMembers();
            case "everyone":
                return $LL.broadcast.config.everyone();
        }
    }

    onMount(() => menuInputFocusStore.set(true));
    onDestroy(() => menuInputFocusStore.set(false));
</script>

<div class="u-eyebrow">{$LL.broadcast.config.who()}</div>
<div class="flex flex-col" role="radiogroup" aria-label={$LL.broadcast.config.who()}>
    {#each WHO_ORDER as candidate (candidate)}
        <button
            type="button"
            class="u-menu-row"
            class:u-selected={who === candidate}
            role="radio"
            aria-checked={who === candidate}
            on:click={() => {
                who = candidate;
                error = undefined;
            }}
            data-testid="broadcast-settings-who-{candidate}"
        >
            <span class="u-menu-label ps-1">{whoLabel(candidate)}</span>
            {#if who === candidate}<IconCheck font-size="16" aria-hidden="true" />{/if}
        </button>
    {/each}
</div>
{#if roomGroup !== null}
    <p class="m-0 flex items-center gap-2 px-1 text-xs text-white/60">
        <IconUsers font-size="16" class="flex-none" aria-hidden="true" />
        {$LL.broadcast.config.rolesNote()}
    </p>
{/if}

<div class="u-eyebrow mt-1">{$LL.broadcast.config.reach()}</div>
<div class="flex flex-col" role="radiogroup" aria-label={$LL.broadcast.config.reach()}>
    {#each reaches as reach, index (reach)}
        {@const included = index < farIndex}
        <button
            type="button"
            class="u-menu-row"
            class:u-selected={far === reach}
            class:u-included={included}
            role="radio"
            aria-checked={far === reach}
            on:click={() => (far = reach)}
            data-testid="broadcast-settings-reach-{reach}"
        >
            <span class="u-menu-tile" aria-hidden="true"><svelte:component this={icons[reach]} /></span>
            <span class="u-menu-label !whitespace-normal leading-tight">
                <span class="block">{reachTitle($LL, reach)}</span>
                <span class="block text-xs font-normal text-white/60">
                    {[
                        reachDetail($LL, reach, $broadcastReachInfoStore),
                        reach === "UNIVERSE" ? $LL.broadcast.config.universeAdminsOnly() : "",
                    ]
                        .filter((part) => part)
                        .join(" · ")}
                </span>
            </span>
            {#if included}
                <span class="flex-none text-[11px] font-semibold text-[#c4b5fd]">{$LL.broadcast.config.included()}</span
                >
            {/if}
            {#if far === reach}<IconCheck font-size="16" class="flex-none" aria-hidden="true" />{/if}
        </button>
    {/each}
</div>
{#if reaches.length > 1}
    <p class="m-0 flex items-center gap-2 px-1 text-xs text-white/60">
        <IconInfoCircle font-size="16" class="flex-none" aria-hidden="true" />
        {$LL.broadcast.config.includesAbove()}
    </p>
{/if}
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
