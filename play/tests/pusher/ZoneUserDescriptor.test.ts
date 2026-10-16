import { describe, expect, it } from "vitest";
import { AvailabilityStatus, SetPlayerDetailsMessage, UserJoinedZoneMessage } from "@workadventure/messages";
import { UserDescriptor } from "../../src/pusher/models/Zone";

const joinedTextures = [
    { id: "body", url: "https://play.example.com/body.png" },
    { id: "hat", url: "https://play.example.com/hat.png" },
];
const joinedCompanion = { id: "dog", url: "https://play.example.com/dog.png" };

function userWhoJoined(): UserDescriptor {
    return UserDescriptor.createFromUserJoinedZoneMessage(
        UserJoinedZoneMessage.fromPartial({
            userId: 1,
            userUuid: "uuid-1",
            name: "Pat",
            characterTextures: joinedTextures,
            companionTexture: joinedCompanion,
            position: { x: 0, y: 0, moving: false, direction: 0 },
            availabilityStatus: AvailabilityStatus.ONLINE,
        })
    );
}

describe("UserDescriptor.updateDetails, textures", () => {
    it("takes new textures that all have a url", () => {
        const user = userWhoJoined();
        const worn = [{ id: "cape", url: "https://play.example.com/cape.png" }];
        user.updateDetails(SetPlayerDetailsMessage.fromPartial({ characterTextures: worn }));
        expect(user.toUserJoinedMessage().characterTextures).toEqual(worn);
    });

    it("ignores textures sent as ids only, so others never draw a blank Woka", () => {
        const user = userWhoJoined();
        user.updateDetails(SetPlayerDetailsMessage.fromPartial({ characterTextures: [{ id: "cape", url: "" }] }));
        expect(user.toUserJoinedMessage().characterTextures).toEqual(joinedTextures);
    });

    it("ignores a list in which any texture has no url", () => {
        const user = userWhoJoined();
        user.updateDetails(
            SetPlayerDetailsMessage.fromPartial({
                characterTextures: [
                    { id: "cape", url: "https://play.example.com/cape.png" },
                    { id: "mask", url: "" },
                ],
            })
        );
        expect(user.toUserJoinedMessage().characterTextures).toEqual(joinedTextures);
    });

    it("keeps the textures when an update carries none", () => {
        const user = userWhoJoined();
        user.updateDetails(SetPlayerDetailsMessage.fromPartial({ outlineColor: 5 }));
        expect(user.toUserJoinedMessage().characterTextures).toEqual(joinedTextures);
    });

    it("takes a new companion that has a url, and ignores one that has none", () => {
        const user = userWhoJoined();
        user.updateDetails(SetPlayerDetailsMessage.fromPartial({ companionTexture: { id: "cat", url: "" } }));
        expect(user.toUserJoinedMessage().companionTexture).toEqual(joinedCompanion);

        const cat = { id: "cat", url: "https://play.example.com/cat.png" };
        user.updateDetails(SetPlayerDetailsMessage.fromPartial({ companionTexture: cat }));
        expect(user.toUserJoinedMessage().companionTexture).toEqual(cat);
    });
});
