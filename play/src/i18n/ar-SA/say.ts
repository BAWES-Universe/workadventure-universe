import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "مرحبًا 👋",
        brb: "سأعود حالًا",
        thanks: "شكرًا",
        ok: "حسنًا",
    },
    type: {
        say: "قل",
        think: "فكر",
    },
    placeholder: "اكتب رسالتك هنا...",
    button: "إنشاء فقاعة",
    express: {
        button: "عبّر عن نفسك",
        close: "إغلاق",
        placeholder: "قل شيئًا…",
        say: "قل",
        think: "فكّر",
        send: "إرسال",
        emote: "تشغيل {emoji}",
        emotes: "تعابيرك",
        forcedSay: "في الاجتماع تُقال الفقاعات بصوت عالٍ",
        forcedThink: "عندما تكون بعيدًا أو مشغولًا تصبح الفقاعات أفكارًا",
        sayHint: "يراها كل من يراك لمدة 5 ثوانٍ",
        thinkHint: "تبقى فوقك حتى تتحرك",
        enterToSend: "Enter للإرسال",
        phrases: "عبارات سريعة",
        edit: "تعديل",
        done: "تم",
        editTitle: "تعديل التعبير",
        editHint: "المس رمزًا تعبيريًا أو عبارة لتغييرها",
        changeEmote: "تغيير {emoji}",
        editPhrase: "تعديل «{phrase}»",
    },
    tooltip: {
        description: {
            say: "يعرض فقاعة دردشة فوق شخصيتك. مرئية للجميع على الخريطة، وتظل معروضة لمدة 5 ثوانٍ.",
            think: "يعرض فقاعة تفكير فوق شخصيتك. مرئية لجميع اللاعبين على الخريطة، وتظل معروضة طالما أنك لا تتحرك.",
        },
    },
};

export default say;
