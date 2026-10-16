<script lang="ts">
    // Our roles as tick rows, with the old typed-tag field kept below for any other tag. A role is a user tag:
    // Orbit answers the tag search with admin, editor and member (app/api/world/tags/route.ts in the admin).
    // Without an admin back office the answer is empty and only the typed field shows, as before.
    import { onMount } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import InputRoomTags from "./InputRoomTags.svelte";
    import InfoButton from "./InfoButton.svelte";
    import type { InputTagOption } from "./InputTagOption";
    import { IconCheck, IconInfoCircle } from "@wa-icons";

    export let value: InputTagOption[] | undefined;
    export let label: string;
    export let emptyText: string;
    export let handleChange: () => void = () => {};
    export let testId: string | undefined = undefined;

    const ROLE_ORDER = ["admin", "editor", "member"];
    let roles: string[] = [];
    let ticked = new Set<string>();
    let others: InputTagOption[] = [];
    let showOthers = false;
    let loaded = false;

    function split(options: InputTagOption[] | undefined) {
        ticked = new Set((options ?? []).filter((o) => ROLE_ORDER.includes(o.value)).map((o) => o.value));
        others = (options ?? []).filter((o) => !ROLE_ORDER.includes(o.value));
        showOthers = others.length > 0;
    }

    onMount(async () => {
        split(value);
        try {
            const answer = await gameManager.getCurrentGameScene().connection?.queryTags("");
            roles = ROLE_ORDER.filter((role) => answer?.includes(role));
        } catch (error) {
            console.error(error);
        }
        loaded = true;
    });

    function commit() {
        const picked: InputTagOption[] = ROLE_ORDER.filter((role) => ticked.has(role)).map((role) => ({
            value: role,
            label: role,
            created: false,
        }));
        value = [...picked, ...others];
        handleChange();
    }

    function toggle(role: string) {
        if (ticked.has(role)) ticked.delete(role);
        else ticked.add(role);
        ticked = ticked;
        commit();
    }

    function title(role: string): string {
        if (role === "admin") return $LL.mapEditor.properties.rolePicker.admin();
        if (role === "editor") return $LL.mapEditor.properties.rolePicker.editor();
        return $LL.mapEditor.properties.rolePicker.member();
    }

    function text(role: string): string {
        if (role === "admin") return $LL.mapEditor.properties.rolePicker.adminText();
        if (role === "editor") return $LL.mapEditor.properties.rolePicker.editorText();
        return $LL.mapEditor.properties.rolePicker.memberText();
    }
</script>

{#if loaded && roles.length === 0}
    <!-- No roles from the back office: the typed field, exactly as it was. -->
    <InputRoomTags {label} bind:value {handleChange} {testId}>
        <span slot="info"><slot name="info" /></span>
    </InputRoomTags>
{:else if loaded}
    <!-- Shown once the roles are known, so the test id never points at a half-built picker. -->
    <div class="rp" data-testid={testId}>
        <div class="rp-label">
            <span>{label}</span>
            {#if $$slots.info}
                <InfoButton><slot name="info" /></InfoButton>
            {/if}
        </div>
        <div class="rp-list" role="group" aria-label={label}>
            {#each roles as role (role)}
                <!-- Picked the way you pick your status: the picked rows are tinted and bold, with a check. -->
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={ticked.has(role)}
                    class="u-menu-row rp-row"
                    class:u-selected={ticked.has(role)}
                    data-testid="{testId}-{role}"
                    on:click={() => toggle(role)}
                >
                    <span class="rp-tx">
                        <span class="rp-t">{title(role)}</span>
                        <span class="rp-m">{text(role)}</span>
                    </span>
                    {#if ticked.has(role)}
                        <IconCheck class="flex-none" font-size="18" />
                    {/if}
                </button>
            {/each}
        </div>
        {#if ticked.size === 0 && others.length === 0}
            <span class="rp-empty">{emptyText}</span>
        {/if}
        {#if showOthers}
            <InputRoomTags
                label={$LL.mapEditor.properties.rolePicker.otherTags()}
                placeholder={$LL.mapEditor.properties.rolePicker.typeATag()}
                bind:value={others}
                handleChange={commit}
                testId="{testId}-other"
            >
                <span slot="info">
                    <IconInfoCircle font-size="15" />
                    {$LL.mapEditor.properties.rolePicker.otherTagsInfo()}
                </span>
            </InputRoomTags>
        {:else}
            <button
                type="button"
                class="rp-add u-cta-secondary h-11 m-0 px-4 rounded-full text-sm font-bold"
                on:click={() => (showOthers = true)}
            >
                {$LL.mapEditor.properties.rolePicker.addAnotherTag()}
            </button>
        {/if}
    </div>
{/if}

<style>
    .rp {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .rp-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 14px;
        color: #fff;
    }
    .rp-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .rp-list {
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .rp-row {
        gap: 12px;
        min-height: 52px;
        margin: 0;
        padding: 6px 12px;
    }
    .rp-tx {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }
    .rp-t {
        font-size: 14px;
    }
    .rp-m {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .rp-empty {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    /* The typed field's label lines up with the labels above it. */
    .rp :global(.input-label) {
        padding-left: 0;
        padding-right: 0;
    }
    .rp-add {
        align-self: flex-start;
    }
</style>
