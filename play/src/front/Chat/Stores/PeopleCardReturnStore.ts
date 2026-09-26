import { get } from "svelte/store";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import { wokaMenuStore } from "../../Stores/WokaMenuStore";
import { chatSidebarWidthStore } from "../ChatSidebarWidthStore";
import { navChat } from "./ChatStore";
import { createPeopleCardReturn, sidebarCoversMap } from "./PeopleCardReturn";

/** The app's People tab ↔ person card flow on phones (see PeopleCardReturn). */
export const peopleCardReturn = createPeopleCardReturn({
    chatVisible: chatVisibilityStore,
    card: wokaMenuStore,
    clearCard: () => wokaMenuStore.clear(),
    coversMap: () => {
        // The sidebar as shown (its CSS can differ from the stored width on small screens).
        const shownWidth = document.getElementById("chat")?.getBoundingClientRect().width;
        return sidebarCoversMap(window.innerWidth, shownWidth ?? get(chatSidebarWidthStore));
    },
    showPeople: () => navChat.switchToUserList(),
});
