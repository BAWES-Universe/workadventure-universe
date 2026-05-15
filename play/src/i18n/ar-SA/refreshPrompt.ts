import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const refreshPrompt: DeepPartial<Translation["refreshPrompt"]> = {
    refresh: "تحديث", // Refresh
    serviceWorkerUpdate: {
        message: "تم تحديث اللعبة - اضغط لإعادة التحميل",
        reload: "إعادة التحميل",
        later: "لاحقًا",
        dismissLabel: "إغلاق إشعار التحديث",
    },
    nativeUpdate: {
        modal: {
            title: "يرجى تحديث التطبيق",
            message: "الإصدار {currentVersion} لم يعد مدعومًا. حدّث إلى {requiredVersion} أو أحدث للمتابعة.",
            updateButton: "تحديث التطبيق",
            retryButton: "المحاولة مرة أخرى",
        },
        banner: {
            message: "يتوفر إصدار جديد من التطبيق {latestVersion}.",
            updateButton: "تحديث",
            laterButton: "لاحقًا",
            dismissLabel: "إغلاق إشعار تحديث التطبيق",
        },
    },
};

export default refreshPrompt;
