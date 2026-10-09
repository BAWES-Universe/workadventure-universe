import { expect, test } from "../lib/game";
import { editRoom, scene } from "../lib/me";

// Players here can edit by default (the local stack has no Orbit to say who may). To see a refusal, start the stack with
// MAP_EDITOR_ALLOW_ALL_USERS=false so that the player is an ordinary one, as in the real game.
test("ME-092 @local A player who may not upload gets a notice that the edit wasn't saved", async ({
    page,
}, testInfo) => {
    test.skip(
        process.env.MAP_EDITOR_ALLOW_ALL_USERS !== "false",
        "needs a stack where players can't edit (MAP_EDITOR_ALLOW_ALL_USERS=false)"
    );
    await editRoom(page, testInfo);

    // What "Add your own" sends: only editors may upload objects, so the server turns it down.
    await scene(page, (s) =>
        s.connection.emitMapEditorUploadEntity(`refused-${Date.now()}`, {
            file: new Uint8Array([1, 2, 3]),
            id: "refused",
            name: "Refused",
            tags: [],
            imagePath: "refused.png",
            direction: 0,
            color: "",
        })
    );
    await expect(page.getByTestId("warning-toast")).toContainText("That change wasn't saved");
});
