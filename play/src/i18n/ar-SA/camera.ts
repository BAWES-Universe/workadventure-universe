import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "تحرير الكاميرا",
    editMic: "تحرير الميكروفون",
    editSpeaker: "تحرير إخراج الصوت",
    active: "نشط",
    disabled: "معطل",
    notRecommended: "غير موصى به",
    enable: {
        title: "يرجى تشغيل الكاميرا والميكروفون.", // Please turn on your camera and microphone.
        start: "لنبدأ!", // Let's start!
        howToAllow: "كيفية السماح", // How to allow
        blockedHintIosApp: "أغلق Universe من مبدّل التطبيقات، ثم افتحه مجدداً واضغط «حاول مرة أخرى».", // Close Universe from the app switcher, open it again, then tap Try again.
        blockedHintIosBrowser:
            "اضغط aA في شريط العنوان › إعدادات الموقع، واسمح بالكاميرا والميكروفون، ثم اضغط «حاول مرة أخرى».", // Tap aA in the address bar › Website Settings, allow Camera and Microphone, then tap Try again.
    },
    help: {
        title: "مطلوب الوصول إلى الكاميرا / الميكروفون", // Access to camera/microphone required
        permissionDenied: "تم الرفض", // Access denied
        content: "يجب السماح بالوصول إلى الكاميرا والميكروفون في المتصفح.", // Access to camera and microphone must be allowed in the browser.
        firefoxContent: 'يرجى النقر على زر "حفظ هذا القرار" لمنع طلبات الإذن المتكررة في Firefox.', // Please click the "Save this decision" button to prevent repeated permission requests in Firefox.
        continue: "المتابعة بدون كاميرا", // Continue without camera
        why: "ليراك ويسمعك من تقترب منهم. يمكنك إيقافهما في أي وقت.",
        allow: "السماح بالكاميرا", // Allow camera
        iosTitle: "الكاميرا محظورة", // Camera is blocked
        iosWhy: "لا يستطيع الآخرون رؤيتك. يستغرق هذا دقيقة تقريباً.", // People can't see you. This takes about a minute.
        tryAgain: "حاول مرة أخرى", // Try again
        tryAgainDone: "حاولنا مرة أخرى. إذا لم يسألك الآيفون، اتبع الخطوة 2.", // Tried again. If iPhone didn't ask, follow step 2.
        steps: {
            tryAgain: "اضغط «حاول مرة أخرى». إذا سألك الآيفون، اضغط «سماح».", // Tap Try again. If iPhone asks, tap Allow.
            closeApp:
                "لم يظهر سؤال؟ أغلق Universe: اسحب لأعلى من أسفل الشاشة، توقف قليلاً، ثم اسحب Universe لأعلى. افتحه واضغط زر الكاميرا.", // Nothing asked? Close Universe: swipe up from the bottom edge, pause, flick Universe up. Open it and tap the camera button.
            settingsApp:
                "ما زالت محظورة؟ افتح الإعدادات › التطبيقات › Safari › الكاميرا واختر «اسأل» أو «سماح». كرر ذلك للميكروفون. ثم أعد الخطوة 2.", // Still blocked? Open Settings › Apps › Safari › Camera and choose Ask or Allow. Do the same for Microphone. Then repeat step 2.
            settingsTab:
                "ما زالت محظورة؟ اضغط aA في شريط العنوان › إعدادات الموقع › الكاميرا واختر «اسأل» أو «سماح». كرر ذلك للميكروفون. ثم أعد تحميل الصفحة.", // Still blocked? Tap aA in the address bar › Website Settings › Camera and choose Ask or Allow. Do the same for Microphone. Then reload the page.
            olderIphone: "آيفون أقدم: الإعدادات › Safari.", // Older iPhone: Settings › Safari.
        },
        screen: {
            firefox: "/resources/help-setting-camera-permission/ar-SA-firefox.png", // Firefox help setting camera permission
            chrome: "/resources/help-setting-camera-permission/ar-SA-chrome.png", // Chrome help setting camera permission
        },
    },
    webrtc: {
        title: "خادم ترحيل الفيديو لا يستجيب - خطأ", // The video relay server is not responding - Error
        titlePending: "الاتصال بخادم ترحيل الفيديو", // Connecting to the video relay server
        error: 'خادم "TURN" غير متاح', // "TURN" server not reachable
        content: "لم يتمكن من إنشاء اتصال بخادم ترحيل الفيديو. قد لا تتمكن من التواصل مع المستخدمين الآخرين.", // A connection to the video relay server could not be established. You may not be able to communicate with other users.
        solutionVpn: "إذا كنت تتصل عبر VPN، يرجى قطع الاتصال بـ VPN وتحديث الصفحة.", // If you are connecting via VPN, please disconnect from the VPN and refresh the page.
        solutionHotspot:
            "إذا كنت في شبكة مقيدة (شبكة الشركة...)، حاول تغيير الشبكة. على سبيل المثال، قم بإنشاء نقطة اتصال Wi-Fi باستخدام هاتفك واتصل عبر هاتفك.", // If you are in a restricted network (company network...), try changing the network. For example, create a Wi-Fi hotspot with your phone and connect via your phone.
        solutionNetworkAdmin: "إذا كنت مسؤول الشبكة، تحقق من", // If you are a network administrator, check the
        preparingYouNetworkGuide: 'دليل "إعداد شبكتك"', // "Preparing your network" guide
        refresh: "تحديث", // Refresh
        continue: "استمرار", // Continue
        solutionVpnNotAskAgain: "فهمت. لا تحذرني مرة أخرى 🫡",
    },
    my: {
        silentZone: "منطقة صامتة", // Silent zone
        nameTag: "أنت", // You
        silentZoneDesc:
            "أنت في منطقة صامتة. لا يمكنك سوى رؤية وسماع الأشخاص الذين معك. لا يمكنك رؤية أو سماع الأشخاص الآخرين في الغرفة.",
        loading: "جارٍ تحميل الكاميرا...", // Loading your camera...
    },
    disable: "إيقاف الكاميرا", // Disable camera
    menu: {
        moreAction: "خيارات إضافية", // More actions
        closeMenu: "إغلاق القائمة", // Close menu
        senPrivateMessage: "إرسال رسالة خاصة (قريبًا)", // Send private message (coming soon)
        kickoffUser: "طرد المستخدم", // Kick off user
        muteAudioUser: "كتم صوت المستخدم", // Mute user's audio
        muteAudioEveryBody: "كتم الصوت للجميع", // Mute audio for everybody
        muteVideoUser: "كتم فيديو المستخدم", // Mute user's video
        muteVideoEveryBody: "كتم الفيديو للجميع", // Mute video for everybody
        blockOrReportUser: "حظر أو الإبلاغ عن المستخدم", // Block or report user
    },
};

export default camera;
