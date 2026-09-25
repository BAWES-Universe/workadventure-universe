import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const notification: DeepPartial<Translation["notification"]> = {
    discussion: "{name} と話し合いたい",
    message: "{name} からメッセージを送信",
    chatRoom: "チャットルームで",
    askToMuteMicrophone: "マイクのミュートを依頼します 🙏",
    askToMuteCamera: "カメラのミュートを依頼します 🙏",
    help: {
        title: "通知へのアクセス拒否",
        permissionDenied: "拒否されました",
        content:
            "会話を見逃さない。Universe タブを開いていなくても、誰かがあなたと話したがっていることを通知できるように、通知を有効にしてください。",
        refresh: "更新",
        continue: "通知なしで続行",
    },
    addNewTag: '新しいタグを追加する : "{tag}"',
};

export default notification;
