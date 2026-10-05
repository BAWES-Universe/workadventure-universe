import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "يتبع {leader}", // following {leader}
        waitingFollowers: "في انتظار التأكيد...", // Waiting for confirmation...
        followed: {
            one: "{follower} يتبعك", // {follower} is following you
            two: "{firstFollower} و {secondFollower} يتبعانك", // {firstFollower} and {secondFollower} are following you
            many: "{followers} و {lastFollower} يتبعونك", // {followers} and {lastFollower} are following you
        },
    },
    interactMenu: {
        stop: {
            leader: "هل ترغب في عدم الاستمرار في القيادة؟", // Do you not want to continue leading?
            follower: "هل ترغب في عدم متابعة {leader} بعد الآن؟", // Do you not want to follow {leader} anymore?
        },
        yes: "نعم", // Yes
        no: "لا", // No
    },
    actionName: "تحديد الموقع",
    ask: {
        one: "يطلب من {name} أن يتبعك",
        many: "يطلب من {count} أشخاص أن يتبعوك",
    },
    request: {
        titleOne: "طلبت من {name} أن يتبعك",
        titleMany: "طلبت من {count} أشخاص أن يتبعوك",
        waiting: "في انتظار الرد",
        anyone: "من يوافق يبدأ في تتبعك فورًا",
        cancel: "إلغاء الطلب",
        state: {
            waiting: "في الانتظار…",
            following: "يتبعك",
            declined: "رفض",
        },
    },
    question: {
        title: "{leader} يريدك أن تتبعه",
        desc: "تمشي شخصيتك Woka خلف {leader} حتى تتوقف",
        notNow: "ليس الآن",
        follow: "اتبع",
    },
    stop: "إيقاف",
    notes: {
        saidNo: "رفض {name}",
        noAnswer: "لم يرد {name}",
        nobodySaidYes: "لم يوافق أحد",
        cancelled: "ألغى {leader} طلب المتابعة",
        stoppedLeading: "توقف {leader} عن القيادة",
        timedOut: "انتهت مهلة طلب المتابعة",
    },
    menu: {
        cancel: "إلغاء طلب المتابعة",
        stopLeading: "إيقاف القيادة",
    },
};
export default follow;
