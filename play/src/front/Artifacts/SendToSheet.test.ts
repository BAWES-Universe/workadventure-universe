/* eslint-disable no-await-in-loop -- the tests wait for the screen to settle, one step after another */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get, readable, writable, type Writable } from "svelte/store";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

const ME = "@me:chat.test";
const world = vi.hoisted(() => ({
    directRooms: undefined as unknown,
    rooms: undefined as unknown,
    /** The direct chats as a list a test can change while the sheet is open. */
    directStore: undefined as unknown,
}));

vi.mock("../Phaser/Game/GameManager", async () => {
    const { readable: store } = await import("svelte/store");
    return {
        gameManager: {
            get chatConnection() {
                return {
                    directRooms: (world.directStore as never) ?? store(world.directRooms ?? []),
                    rooms: store(world.rooms ?? []),
                    folders: store([]),
                };
            },
            getCurrentGameScene: () => {
                throw new Error("no map yet");
            },
        },
    };
});
vi.mock("../Connection/LocalUserStore", () => ({ localUserStore: { getChatId: () => "@me:chat.test" } }));
vi.mock("../Chat/Stores/AreaPresenceStore", async () => {
    const { readable: store } = await import("svelte/store");
    return { areaChatRooms: { hiddenRoomIds: store(new Set<string>()) } };
});
vi.mock("../Chat/Stores/ChatPeopleLookup", () => ({
    currentChatPeople: () => undefined,
    requestChatPerson: () => undefined,
}));
vi.mock("../Chat/Stores/ChatUserWokaStore", () => ({
    createWokaByChatIdStore: () => undefined,
    createNameByChatIdStore: () => undefined,
    createColourByChatIdStore: () => undefined,
    personColour: () => undefined,
    personName: (names: Map<string, string>, chatId: string | undefined, roomName: string) =>
        (chatId ? names.get(chatId) : undefined) ?? roomName,
    personPicture: (_wokas: unknown, _chatId: unknown, account: unknown) => account,
}));
vi.mock("../Chat/Components/OneList/OneListStore", async () => {
    const { readable: store } = await import("svelte/store");
    return { directRoomsWithStore: () => store([]) };
});
const bricks = vi.hoisted(() => ({ byChatId: new Map<string, unknown>() }));
vi.mock("../Chat/Bricks/MyBricksStore", async () => {
    const { readable: store } = await import("svelte/store");
    return {
        brickPicture: () => undefined,
        myBricksByChatId: {
            subscribe: (run: (value: Map<string, unknown>) => void) => store(bricks.byChatId).subscribe(run),
        },
        myDeletedBrickChatIds: store(new Set<string>()),
        withMyBricks: (people: unknown) => people,
    };
});

import { loadLocale } from "../../i18n/i18n-util.sync";
import { setLocale } from "../../i18n/i18n-svelte";
import { chatDoneToastStore } from "../Stores/ChatDoneToastStore";
import { closeSendTo, openSendTo, sendToRequest } from "./sendToStore";
import SendToHost from "./SendToHost.svelte";

const MY_BRICK = "@bot_nudge:chat.test";
const OTHER_BRICK = "@bot_theirs:chat.test";

function room(id: string, type: "direct" | "multiple", name: string, memberIds: string[], timestamp = 0) {
    return {
        id,
        type,
        name: readable(name),
        members: readable(memberIds.map((memberId) => ({ id: memberId }))),
        lastMessageTimestamp: timestamp,
        pictureStore: readable(undefined),
        sendFileOrThrow: vi.fn().mockResolvedValue(undefined),
        sendMessageConfirmed: vi.fn().mockResolvedValue(undefined),
    };
}

type Room = ReturnType<typeof room>;

const settle = async () => {
    for (let i = 0; i < 5; i++) await tick();
    await Promise.resolve();
    await tick();
};

const q = (testId: string) => document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const all = (testId: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
const rowFor = (name: string) => all("sendToRow").find((row) => row.textContent?.includes(name));

const file = new File(["# Notes"], "Calendar notes.md", { type: "text/markdown" });
const docLink = (openScope: string, extra: Record<string, unknown> = {}) => ({
    url: "https://orbit.test/a/d1",
    openScope,
    owner: true,
    published: null,
    latest: 2,
    ...extra,
});

let view: SendToHost | undefined;
let directList: Writable<Room[]>;
async function show(request: Parameters<typeof openSendTo>[0], rooms: { direct?: Room[]; groups?: Room[] } = {}) {
    world.directRooms = rooms.direct ?? [];
    directList = writable(rooms.direct ?? []);
    world.directStore = directList;
    world.rooms = rooms.groups ?? [];
    const target = document.createElement("div");
    document.body.appendChild(target);
    view = new SendToHost({ target });
    openSendTo(request);
    await settle();
}

describe("the Send to sheet", () => {
    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    afterEach(() => {
        view?.$destroy();
        view = undefined;
        world.directStore = undefined;
        closeSendTo();
        chatDoneToastStore.set(undefined);
        bricks.byChatId = new Map();
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    const request = (link?: ReturnType<typeof docLink>) => ({
        fileName: "Calendar notes.md",
        makeFile: () => Promise.resolve(file),
        link,
    });

    it("says there is no one to send to when the person has no chats", async () => {
        await show(request(docLink("link")));
        expect(q("sendToEmpty")?.textContent).toContain("No one to send to yet. Add a friend or make a Brick first.");
        expect(all("sendToRow")).toHaveLength(0);
    });

    it("lists Bricks first and then friends and chats, and a search keeps who matches", async () => {
        bricks.byChatId = new Map([[MY_BRICK, { id: "nudge", name: "Nudge Brick", characterTextureId: null }]]);
        const nudge = room("r1", "direct", "raw", [ME, MY_BRICK], 10);
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"], 30);
        const team = room("r3", "multiple", "Team room", [ME, "@a:chat.test", "@b:chat.test"], 20);
        await show(request(docLink("link")), { direct: [laura, nudge], groups: [team] });

        const names = all("sendToRow").map((row) => row.querySelector("b")?.textContent);
        // Your Brick is named as the Brick, whatever the chat server calls its chat
        expect(names).toEqual(["Nudge Brick", "Laura", "Team room"]);
        expect(rowFor("Team room")?.textContent).toContain("3 people");
        expect(q("sendToList")?.textContent).toContain("Bricks");
        expect(q("sendToList")?.textContent).toContain("Friends and chats");

        const search = q("sendToSearch") as HTMLInputElement;
        search.value = "lau";
        search.dispatchEvent(new Event("input"));
        await settle();
        expect(all("sendToRow").map((row) => row.querySelector("b")?.textContent)).toEqual(["Laura"]);
        search.value = "zzz";
        search.dispatchEvent(new Event("input"));
        await settle();
        expect(q("sendToEmpty")?.textContent).toContain("No one matches that.");
    });

    it("sends nothing on a tap on a name: it asks what to send first", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(docLink("link")), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        expect(laura.sendFileOrThrow).not.toHaveBeenCalled();
        expect(laura.sendMessageConfirmed).not.toHaveBeenCalled();
        expect(q("sendToFile")?.textContent).toContain("Calendar notes.md · always opens for Laura");
    });

    it("cannot send a link of a document only you can open to a person, and offers the file", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(docLink("me")), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        const link = q("sendToLink") as HTMLButtonElement;
        expect(link.getAttribute("aria-disabled")).toBe("true");
        expect(q("sendToLinkLine")?.textContent).toBe(
            "Only you can open this doc, so a link would not work for Laura. Turn the link on in Share, or send the file."
        );
        link.click();
        await settle();
        expect(link.getAttribute("aria-checked")).toBe("false");

        (q("sendToSend") as HTMLButtonElement).click();
        await settle();
        expect(laura.sendFileOrThrow).toHaveBeenCalledWith(file);
        expect(laura.sendMessageConfirmed).not.toHaveBeenCalled();
    });

    it("treats a Brick you do not own like a person", async () => {
        const theirs = room("r1", "direct", "Their Brick", [ME, OTHER_BRICK]);
        await show(request(docLink("me")), { direct: [theirs] });
        // It is listed with the Bricks, but handled as a person: the same plain warning, the file still offered
        expect(q("sendToList")?.textContent).toContain("Bricks");
        rowFor("Their Brick")?.click();
        await settle();
        expect(q("sendToFile")?.textContent).toContain("always opens for Their Brick");
        expect(q("sendToLinkLine")?.textContent).toContain("Only you can open this doc");
        expect(q("sendToLink")?.getAttribute("aria-disabled")).toBe("true");
    });

    it("works for your own Brick in a chat of just the two, as the person's own message", async () => {
        bricks.byChatId = new Map([[MY_BRICK, { id: "nudge", name: "Nudge Brick", characterTextureId: null }]]);
        const nudge = room("r1", "direct", "raw", [ME, MY_BRICK]);
        await show(request(docLink("me")), { direct: [nudge] });
        rowFor("Nudge Brick")?.click();
        await settle();
        expect(q("sendToFile")?.textContent).toContain("Calendar notes.md · the Brick reads it from the chat");
        expect(q("sendToLinkLine")?.textContent).toBe("Works for your own Brick even when only you can open it");
        const link = q("sendToLink") as HTMLButtonElement;
        expect(link.getAttribute("aria-disabled")).toBe("false");

        // The link is its own choice, and goes as words with nothing else around them
        link.click();
        await settle();
        (q("sendToFile") as HTMLButtonElement).click();
        await settle();
        (q("sendToSend") as HTMLButtonElement).click();
        await settle();
        expect(nudge.sendMessageConfirmed).toHaveBeenCalledExactlyOnceWith("https://orbit.test/a/d1");
        expect(nudge.sendFileOrThrow).not.toHaveBeenCalled();
    });

    it("shows the warning in a group chat even when your own Brick is in it", async () => {
        bricks.byChatId = new Map([[MY_BRICK, { id: "nudge", name: "Nudge Brick", characterTextureId: null }]]);
        const group = room("r3", "multiple", "Team room", [ME, MY_BRICK, "@laura:chat.test"]);
        await show(request(docLink("me")), { groups: [group] });
        rowFor("Team room")?.click();
        await settle();
        expect(q("sendToFile")?.textContent).toContain("always opens for everyone in this chat");
        expect(q("sendToLinkLine")?.textContent).toContain("Only you can open this doc");
        expect(q("sendToLink")?.getAttribute("aria-disabled")).toBe("true");
    });

    it("says in one plain line what each link setting does", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        const published = { version: 1, at: "2026-11-10T10:00:00.000Z", available: true };
        const cases: [ReturnType<typeof docLink>, string, boolean][] = [
            [
                docLink("chat"),
                "Only people in the chat it was made in can open it, so a link may not open for Laura.",
                true,
            ],
            [docLink("link"), "Opens in Universe. Shows the latest version.", true],
            [
                docLink("link", { published }),
                "Opens in Universe. Shows version 1, the one you published, not the latest.",
                true,
            ],
            [
                docLink("public", { published, latest: 1 }),
                "Opens in Universe. Shows version 1, the one you published.",
                true,
            ],
            [
                docLink("public"),
                "Nothing is published yet, so a link would open for nobody else. Publish a version in Share, or send the file.",
                false,
            ],
            [docLink("link", { owner: false }), "Opens in Universe. Shows what its owner shares by link.", true],
        ];
        for (const [link, line, usable] of cases) {
            await show(request(link), { direct: [laura] });
            rowFor("Laura")?.click();
            await settle();
            expect(q("sendToLinkLine")?.textContent, link.openScope).toBe(line);
            expect(q("sendToLink")?.getAttribute("aria-disabled")).toBe(String(!usable));
            view?.$destroy();
            view = undefined;
            closeSendTo();
            document.body.innerHTML = "";
        }
    });

    it("sends the file and the link together, names who got it, and closes", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(docLink("link")), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        (q("sendToLink") as HTMLButtonElement).click();
        await settle();
        (q("sendToSend") as HTMLButtonElement).click();
        await settle();
        expect(laura.sendFileOrThrow).toHaveBeenCalledWith(file);
        expect(laura.sendMessageConfirmed).toHaveBeenCalledWith("https://orbit.test/a/d1");
        expect(get(chatDoneToastStore)?.text).toBe("Sent to Laura");
        expect(get(sendToRequest)).toBeUndefined();
        expect(q("sendToSheet")).toBeNull();
    });

    it("has a file card's file only: no link to offer for a chat file", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(undefined), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        expect(q("sendToFile")).not.toBeNull();
        expect(q("sendToLink")).toBeNull();
    });

    it("cannot send with nothing chosen", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(docLink("link")), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        (q("sendToFile") as HTMLButtonElement).click();
        await settle();
        expect((q("sendToSend") as HTMLButtonElement).disabled).toBe(true);
    });

    it("says nothing was sent when it failed, and Try again sends it again", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        laura.sendFileOrThrow.mockRejectedValueOnce(new Error("offline"));
        await show(request(undefined), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        (q("sendToSend") as HTMLButtonElement).click();
        await settle();
        expect(q("sendToFailed")?.textContent).toBe("Could not send. Nothing was sent. Try again.");
        expect(get(chatDoneToastStore)).toBeUndefined();
        expect(q("sendToSheet")).not.toBeNull();

        (q("sendToRetry") as HTMLButtonElement).click();
        await settle();
        expect(laura.sendFileOrThrow).toHaveBeenCalledTimes(2);
        expect(get(chatDoneToastStore)?.text).toBe("Sent to Laura");
        expect(q("sendToSheet")).toBeNull();
    });

    it("keeps the failure on show when the chat it was sent to leaves the list while it failed", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        let fail: (reason: Error) => void = () => undefined;
        laura.sendFileOrThrow.mockImplementationOnce(
            () =>
                new Promise<void>((_resolve, reject) => {
                    fail = reject;
                })
        );
        await show(request(undefined), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        (q("sendToSend") as HTMLButtonElement).click();
        await settle();
        // Laura is gone from the list while the file is still going, and then it fails
        directList.set([]);
        await settle();
        fail(new Error("offline"));
        await settle();
        expect(q("sendToFailed")?.textContent).toBe("Could not send. Nothing was sent. Try again.");
        // There is no chat left to try again with
        expect((q("sendToRetry") as HTMLButtonElement).disabled).toBe(true);
        expect(q("sendToClose")).not.toBeNull();
    });

    it("takes the sheet back to the list when the chat it is about leaves the list before anything is sent", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(undefined), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        expect(q("sendToSend")).not.toBeNull();
        directList.set([]);
        await settle();
        expect(q("sendToSend")).toBeNull();
        expect(q("sendToList")).not.toBeNull();
    });

    it("says which part went when only one did, and Try again sends only the other", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        laura.sendFileOrThrow.mockRejectedValueOnce(new Error("upload failed"));
        await show(request(docLink("link")), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        (q("sendToLink") as HTMLButtonElement).click();
        await settle();
        (q("sendToSend") as HTMLButtonElement).click();
        await settle();
        expect(q("sendToFailed")?.textContent).toBe("Sent the link, but could not send the file. Try again.");

        (q("sendToRetry") as HTMLButtonElement).click();
        await settle();
        expect(laura.sendFileOrThrow).toHaveBeenCalledTimes(2);
        // The link already went: it is not sent a second time
        expect(laura.sendMessageConfirmed).toHaveBeenCalledTimes(1);
        expect(get(chatDoneToastStore)?.text).toBe("Sent to Laura");
    });

    it("gives Send the gradient main button and both buttons the 44px size", async () => {
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        await show(request(docLink("link")), { direct: [laura] });
        rowFor("Laura")?.click();
        await settle();
        const send = q("sendToSend") as HTMLButtonElement;
        const cancel = q("sendToCancel") as HTMLButtonElement;
        expect(send.classList.contains("u-cta")).toBe(true);
        expect(cancel.classList.contains("u-cta-secondary")).toBe(true);
        expect(send.classList.contains("st-btn")).toBe(true);
        expect(cancel.classList.contains("st-btn")).toBe(true);
    });

    it("never says Matrix, nor a vendor's name", async () => {
        bricks.byChatId = new Map([[MY_BRICK, { id: "nudge", name: "Nudge Brick", characterTextureId: null }]]);
        const laura = room("r2", "direct", "Laura", [ME, "@laura:chat.test"]);
        const nudge = room("r1", "direct", "raw", [ME, MY_BRICK]);
        const team = room("r3", "multiple", "Team room", [ME, "@a:chat.test", "@b:chat.test"]);
        await show(request(docLink("link")), { direct: [laura, nudge], groups: [team] });
        let text = q("sendToSheet")?.textContent ?? "";
        for (const name of ["Laura", "Nudge Brick", "Team room"]) {
            rowFor(name)?.click();
            await settle();
            text += q("sendToSheet")?.textContent ?? "";
            q("sendToCancel")?.click();
            openSendTo(request(docLink("link")));
            await settle();
        }
        expect(text).not.toMatch(/matrix/i);
    });
});
