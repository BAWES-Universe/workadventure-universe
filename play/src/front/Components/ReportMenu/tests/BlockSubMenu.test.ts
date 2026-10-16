import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run Svelte's server build, where onDestroy does nothing; the menu needs the browser one
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../i18n/i18n-svelte", async () => (await import("../../Woka/tests/i18nStub")).i18nStub);

import { get } from "svelte/store";
import { blackListManager } from "../../../WebRtc/BlackListManager";
import { showReportScreenStore, userReportEmpty } from "../../../Stores/ShowReportScreenStore";
import BlockSubMenu from "../BlockSubMenu.svelte";
import { settle } from "../../Woka/tests/i18nStub";

const ALICE = { userUUID: "uuid-alice", userName: "Alice" };
const BOB = { userUUID: "uuid-bob", userName: "Bob" };

// #902 / #914: the Moderation popup reopened during its 0.3 s fade-out is reused and never remounts, so the
// Block / Unblock label has to follow the block list and the person shown, not only the first open
describe("the Block / Unblock label of the Moderation menu", () => {
    let component: BlockSubMenu | undefined;
    let target: HTMLElement;

    beforeEach(() => {
        for (const uuid of [...blackListManager.getBlackListedUsers()]) blackListManager.cancelBlackList(uuid);
        showReportScreenStore.set({ userUuid: "uuid-alice", userName: "Alice" });
        target = document.createElement("div");
        document.body.appendChild(target);
    });

    afterEach(() => {
        component?.$destroy();
        component = undefined;
        target.remove();
    });

    const button = () => target.querySelector<HTMLButtonElement>('[data-testid="blockmenu-block-user-button"]');
    const label = () => button()?.textContent?.trim();
    const blockLabel = (name: string) => `report.popup.block.block ${JSON.stringify({ userName: name })}`;
    const unblockLabel = (name: string) => `report.popup.block.unblock ${JSON.stringify({ userName: name })}`;

    async function open(props: { userUUID: string | undefined; userName: string }) {
        component = new BlockSubMenu({ target, props });
        await settle();
    }

    it("says Block for someone who is not blocked and Unblock for someone who is", async () => {
        blackListManager.blackList(BOB.userUUID);
        await open(ALICE);
        expect(label()).toBe(blockLabel("Alice"));
        component?.$set(BOB);
        await settle();
        expect(label()).toBe(unblockLabel("Bob"));
    });

    it("follows a block made right after the menu closed, while the same menu is shown again", async () => {
        await open(ALICE);
        expect(label()).toBe(blockLabel("Alice"));

        // Block: the menu closes (it fades out for 0.3 s) ...
        button()?.click();
        await settle();
        expect(blackListManager.isBlackListed(ALICE.userUUID)).toBe(true);
        expect(get(showReportScreenStore)).toBe(userReportEmpty);

        // ... and the same menu is shown again within 1 ms: it is reused, not mounted anew
        expect(label()).toBe(unblockLabel("Alice"));
    });

    it("follows an unblock the same way", async () => {
        blackListManager.blackList(ALICE.userUUID);
        await open(ALICE);
        expect(label()).toBe(unblockLabel("Alice"));

        button()?.click();
        await settle();
        expect(blackListManager.isBlackListed(ALICE.userUUID)).toBe(false);
        expect(label()).toBe(blockLabel("Alice"));
    });

    it("follows the person when the menu is reused for someone else during the fade-out", async () => {
        blackListManager.blackList(BOB.userUUID);
        await open(ALICE);
        expect(label()).toBe(blockLabel("Alice"));

        component?.$set(BOB);
        await settle();
        expect(label()).toBe(unblockLabel("Bob"));

        component?.$set(ALICE);
        await settle();
        expect(label()).toBe(blockLabel("Alice"));
    });

    it("follows a block or unblock made elsewhere while the menu is open", async () => {
        await open(ALICE);
        blackListManager.blackList(ALICE.userUUID);
        await settle();
        expect(label()).toBe(unblockLabel("Alice"));

        blackListManager.cancelBlackList(ALICE.userUUID);
        await settle();
        expect(label()).toBe(blockLabel("Alice"));
    });
});
