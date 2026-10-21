<script lang="ts">
    import { LL } from "../../../../i18n/i18n-svelte";
    import type { HeldRole } from "../../Roles/WorldRoles";

    /** The roles to show, highest first: the first one next to the name, "+N" for the rest. */
    export let roles: HeldRole[] = [];
    export let personName = "";

    let open = false;
    $: top = roles[0];
    $: more = roles.length - 1;

    // Moves the list to the page itself, so a row that is dimmed (someone away) or inside the chat panel's transforms
    // neither fades it nor traps it.
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            },
        };
    }
</script>

{#if top}
    <button
        type="button"
        class="role-badge relative m-0 ms-1 flex min-w-0 max-w-[58%] shrink items-center gap-1 border-0 bg-transparent p-0 text-white"
        data-testid="role-badge"
        aria-label={more > 0
            ? $LL.chat.role.badgeLabelMore({ name: personName, role: top.name, count: more })
            : $LL.chat.role.badgeLabel({ name: personName, role: top.name })}
        on:click|stopPropagation={() => (open = true)}
    >
        <span class="pill flex min-w-0 shrink items-center gap-1 rounded-full px-2">
            <i class="block h-2 w-2 shrink-0 rounded-full" style="background:{top.color}" />
            <span class="truncate text-xxs font-semibold">{top.name}</span>
        </span>
        {#if more > 0}
            <span class="pill shrink-0 rounded-full px-1.5 text-xxs font-semibold">+{more}</span>
        {/if}
    </button>
{/if}

{#if open}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        use:portal
        class="fixed inset-0 z-[9999] flex items-end bg-black/55"
        data-testid="role-list"
        on:click|stopPropagation={() => (open = false)}
    >
        <div
            class="sheet mx-auto w-full max-w-[480px] whitespace-normal rounded-t-3xl px-5 pb-6 pt-5 text-left font-normal"
            role="dialog"
            aria-label={$LL.chat.role.rolesOf({ name: personName })}
            on:click|stopPropagation
        >
            <div class="mb-2 text-xl font-bold [overflow-wrap:anywhere]">
                {$LL.chat.role.rolesOf({ name: personName })}
            </div>
            <ul class="m-0 list-none p-0">
                {#each roles as role (role.key)}
                    <li
                        class="flex min-h-[48px] items-center gap-3 border-b border-white/10 text-base font-semibold last:border-b-0"
                    >
                        <i class="block h-2.5 w-2.5 shrink-0 rounded-full" style="background:{role.color}" />
                        <span class="min-w-0 [overflow-wrap:anywhere]">{role.name}</span>
                    </li>
                {/each}
            </ul>
            <p class="my-3 text-sm text-white/60">{$LL.chat.role.memberNote()}</p>
            <button
                type="button"
                class="u-cta-secondary h-11 w-full rounded-full text-base font-bold"
                on:click|stopPropagation={() => (open = false)}>{$LL.chat.role.close()}</button
            >
        </div>
    </div>
{/if}

<style>
    .pill {
        height: 18px;
        line-height: 16px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.18);
        color: #e9e6f5;
    }
    /* A tap area 44px high without making the row taller */
    .role-badge::before {
        content: "";
        position: absolute;
        inset: -13px 0;
    }
    .sheet {
        background: #14111f;
        border-top: 1px solid rgba(255, 255, 255, 0.14);
    }
</style>
