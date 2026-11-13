import type { Readable } from "svelte/store";
import { derived, writable } from "svelte/store";
import type { ChatConnectionInterface, PartialChatUser } from "../Connection/ChatConnection";
import { botIdFromChatId } from "../Bots/BotChatStatus";
import { searchesForBots } from "../Bricks/Brick";
import type { UserProviderInterface } from "./UserProviderInterface";

export class ChatUserProvider implements UserProviderInterface {
    users: Readable<PartialChatUser[]>;
    private _searchText = writable("");

    constructor(chat: ChatConnectionInterface) {
        this.users = derived(
            [chat.directRoomsUsers, this._searchText],
            ([users, searchText]) => {
                // "Bot" and "Brick" are the same word (game #1995): either, typed whole, finds every bot whatever its name.
                const findsBots = searchesForBots(searchText);
                return (
                    users.filter((user) => {
                        if (findsBots && (user?.isBot === true || botIdFromChatId(user?.chatId) !== undefined)) {
                            return true;
                        }
                        return user?.username?.toLocaleLowerCase().includes(searchText.toLocaleLowerCase());
                    }) || []
                );
            },
            []
        );
    }

    setFilter(searchText: string): Promise<void> {
        return new Promise((res, _) => {
            this._searchText.set(searchText);
            res();
        });
    }
}
