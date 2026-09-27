<script lang="ts">
    import type { ChatUser } from "../../Connection/ChatConnection";
    import type { PersonGroup } from "./PersonSessions";
    import User from "./User.svelte";

    /** One entry per person, with all of their sessions. */
    export let people: Array<PersonGroup<ChatUser>> = [];
    export let isMatrixChatEnabled = true;
</script>

{#each people as person (person.key)}
    <User user={person.primary} sessions={person.sessions} {isMatrixChatEnabled} />
{/each}
