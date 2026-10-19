<script lang="ts">
    // Add a role or a person to the bot. A role is one tap; a person is found by name or email. The new row opens at
    // once, so the owner can change what it says.
    import { onDestroy } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import MemberAutocomplete from "../../../Components/Input/MemberAutocomplete.svelte";
    import { addRule, botPermissionsStore } from "../stores/BotPermissionsStore";
    import { rolesWithoutRule, type BotRule } from "../accessModel";

    export let botId: string;
    /** The row was added: its screen opens */
    export let onAdded: (rule: BotRule) => void;

    $: access = $LL.mapEditor.edit.bots.page.access;
    $: state = $botPermissionsStore;
    $: data = state && state.botId === botId ? state.data : undefined;
    $: roles = data ? rolesWithoutRule(data) : [];

    let busy = false;
    let error: string | undefined;
    // The screen may be left (back, or another bot) while the row is still being added: its answer then opens nothing
    let gone = false;
    onDestroy(() => {
        gone = true;
    });

    async function add(subject: { roleId: string } | { identifier: string }) {
        if (busy) return;
        busy = true;
        error = undefined;
        await addRule(botId, subject)
            .then((rule) => {
                if (!gone) onAdded(rule);
            })
            .catch((e) => {
                error = e instanceof Error ? e.message : access.saveFailed();
            })
            .finally(() => {
                busy = false;
            });
    }
</script>

<div class="ba" data-testid="bot-rule-add">
    {#if roles.length > 0}
        <div class="ba-field">
            <span class="ba-t">{access.addRoles()}</span>
            {#each roles as role (role.id)}
                <button
                    type="button"
                    class="ba-role"
                    disabled={busy}
                    data-testid="bot-rule-add-role"
                    on:click={() => add({ roleId: role.id })}
                >
                    <span class="ba-dot" style="background: {role.color || '#A3A3B5'}" aria-hidden="true" />
                    <span class="ba-name">{role.name}</span>
                </button>
            {/each}
        </div>
    {:else}
        <p class="ba-m">{access.addNoRoles()}</p>
    {/if}

    <div class="ba-field">
        <span class="ba-t">{access.addPeople()}</span>
        <MemberAutocomplete
            placeholder={access.addSearch()}
            on:onSelect={(event) => add({ identifier: event.detail.value })}
        />
    </div>

    {#if busy}
        <p class="ba-m">{access.adding()}</p>
    {/if}
    {#if error}
        <p class="ba-error" role="alert" data-testid="bot-access-error">{error}</p>
    {/if}
</div>

<style>
    .ba {
        display: flex;
        flex-direction: column;
        gap: 18px;
        color: #fff;
    }
    .ba-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .ba-t {
        font-size: 13px;
        font-weight: 600;
    }
    .ba-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .ba-error {
        margin: 0;
        font-size: 12.5px;
        color: #ff8a7a;
    }
    .ba-role {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 44px;
        margin: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    :global([dir="rtl"]) .ba-role {
        text-align: right;
    }
    .ba-role:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (hover: hover) {
        .ba-role:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.09);
        }
    }
    .ba-role:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .ba-dot {
        flex: none;
        width: 10px;
        height: 10px;
        margin: 0 11px;
        border-radius: 50%;
    }
    .ba-name {
        min-width: 0;
        font-size: 14px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
</style>
