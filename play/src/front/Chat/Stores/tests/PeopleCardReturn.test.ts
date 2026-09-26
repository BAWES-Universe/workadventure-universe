import { get, writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { CARD_OPEN_WINDOW_MS, createPeopleCardReturn, sidebarCoversMap } from "../PeopleCardReturn";

function setup(options: { coversMap?: boolean; chatVisible?: boolean } = {}) {
    let time = 0;
    const chatVisible = writable(options.chatVisible ?? true);
    const card = writable<{ userUuid: string } | undefined>(undefined);
    const showPeople = vi.fn();
    const flow = createPeopleCardReturn({
        chatVisible,
        card,
        clearCard: () => card.set(undefined),
        coversMap: () => options.coversMap ?? true,
        showPeople,
        now: () => time,
    });
    return {
        flow,
        chatVisible,
        card,
        showPeople,
        advance: (ms: number) => {
            time += ms;
        },
    };
}

describe("sidebarCoversMap", () => {
    it("is true on a phone, where the card can't fit beside the sidebar", () => {
        expect(sidebarCoversMap(390, 300)).toBe(true);
    });

    it("is false on desktop and a tablet in landscape", () => {
        expect(sidebarCoversMap(1440, 400)).toBe(false);
        expect(sidebarCoversMap(1024, 400)).toBe(false);
    });
});

describe("People tab and a person's card on a phone", () => {
    it("hides the sidebar when their card opens, and brings the People tab back when it is closed", () => {
        const { flow, chatVisible, card, showPeople } = setup();

        flow.tappedPerson("imagine");
        expect(get(chatVisible)).toBe(true);

        card.set({ userUuid: "imagine" });
        expect(get(chatVisible)).toBe(false);

        flow.dismissCard();
        expect(get(card)).toBeUndefined();
        expect(showPeople).toHaveBeenCalledTimes(1);
        expect(get(chatVisible)).toBe(true);
        expect(flow.takeScrollRestore()).toBe(true);
        // Only once.
        expect(flow.takeScrollRestore()).toBe(false);
    });

    it("stays on the map after an action on the card (walk to, message, summon)", () => {
        const { flow, chatVisible, card, showPeople } = setup();

        flow.tappedPerson("imagine");
        card.set({ userUuid: "imagine" });
        // An action closes the card itself.
        card.set(undefined);
        flow.dismissCard();

        expect(showPeople).not.toHaveBeenCalled();
        expect(get(chatVisible)).toBe(false);
    });

    it("keeps the way back while a search finds the person, whose card then opens", () => {
        const { flow, chatVisible, card, showPeople } = setup();

        flow.tappedPerson("imagine");
        // Searching: the card doesn't know who yet.
        card.set({ userUuid: "" });
        expect(get(chatVisible)).toBe(false);
        card.set({ userUuid: "imagine" });
        card.set({ userUuid: "imagine" });

        flow.dismissCard();
        expect(showPeople).toHaveBeenCalledTimes(1);
        expect(get(chatVisible)).toBe(true);
    });

    it("stays on the map when someone else is tapped on the map while the search runs", () => {
        const { flow, chatVisible, card, showPeople } = setup();

        flow.tappedPerson("imagine");
        card.set({ userUuid: "" });
        expect(get(chatVisible)).toBe(false);
        card.set({ userUuid: "someone-else" });

        flow.dismissCard();
        expect(showPeople).not.toHaveBeenCalled();
        expect(get(chatVisible)).toBe(false);
    });

    it("keeps the sidebar when the first card to open is someone else's", () => {
        const { flow, chatVisible, card } = setup();

        flow.tappedPerson("imagine");
        card.set({ userUuid: "someone-else" });

        expect(get(chatVisible)).toBe(true);
    });

    it("stays on the map when someone else's card replaced it (a tap on the map)", () => {
        const { flow, chatVisible, card, showPeople } = setup();

        flow.tappedPerson("imagine");
        card.set({ userUuid: "imagine" });
        card.set({ userUuid: "someone-else" });

        flow.dismissCard();
        expect(get(card)).toBeUndefined();
        expect(showPeople).not.toHaveBeenCalled();
        expect(get(chatVisible)).toBe(false);
    });

    it("stays out of the way when the sidebar was opened again by hand", () => {
        const { flow, chatVisible, card, showPeople } = setup();

        flow.tappedPerson("imagine");
        card.set({ userUuid: "imagine" });
        chatVisible.set(true);
        chatVisible.set(false);
        flow.dismissCard();

        expect(showPeople).not.toHaveBeenCalled();
        expect(get(chatVisible)).toBe(false);
    });

    it("keeps the sidebar when no card opens soon after the tap", () => {
        const { flow, chatVisible, card, advance } = setup();

        flow.tappedPerson("imagine");
        advance(CARD_OPEN_WINDOW_MS + 1);
        // A card opening much later (someone tapped on the map) isn't this tap's.
        card.set({ userUuid: "someone" });

        expect(get(chatVisible)).toBe(true);
    });

    it("changes nothing where the card fits beside the sidebar (desktop)", () => {
        const { flow, chatVisible, card, showPeople } = setup({ coversMap: false });

        flow.tappedPerson("imagine");
        card.set({ userUuid: "imagine" });
        expect(get(chatVisible)).toBe(true);

        flow.dismissCard();
        expect(get(card)).toBeUndefined();
        expect(showPeople).not.toHaveBeenCalled();
        expect(flow.takeScrollRestore()).toBe(false);
    });

    it("just closes a card that wasn't opened from the People tab", () => {
        const { flow, chatVisible, card, showPeople } = setup({ chatVisible: false });

        card.set({ userUuid: "tapped-on-map" });
        flow.dismissCard();

        expect(get(card)).toBeUndefined();
        expect(showPeople).not.toHaveBeenCalled();
        expect(get(chatVisible)).toBe(false);
    });
});
