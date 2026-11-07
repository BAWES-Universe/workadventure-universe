import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const mapEditor: DeepPartial<Translation["mapEditor"]> = {
    map: {
        refreshPrompt: "تم اكتشاف إصدار جديد من الخريطة. يتطلب التحديث", // Neue Version der Karte erkannt. Aktualisierung erforderlich
    },
    sideBar: {
        areaEditor: "تحرير المنطقة", // Fläche bearbeiten
        entityEditor: "تحرير الكيان", // Entität bearbeiten
        tileEditor: "تحرير البلاطة", // Kachel bearbeiten
        trashEditor: "سلة المهملات", // Papierkorb
        exploreTheRoom: "استكشاف الغرفة", // Raum erkunden
        closeMapEditor: "إغلاق محرر الخريطة", // Karteneditor schließen
        mapManagerActivated: "تم تفعيل مدير الخريطة", // Kartenmanager aktiviert
        mapExplorerActivated: "تم تفعيل مستكشف الخريطة", // Kartenübersicht
        exploreTheRoomActivated: "تم تفعيل استكشاف الغرفة", // Raum erkunden aktiviert
        areaEditorActivated: "تم تفعيل تحرير المنطقة", // Fläche bearbeiten aktiviert
        entityEditorActivated: "تم تفعيل تحرير الكيان", // Entität bearbeiten aktiviert
        trashEditorActivated: "تم تفعيل سلة المهملات", // Papierkorb aktiviert
    },
    properties: {
        silent: {
            label: "صامت",
            description: "عدم السماح بإجراء محادثات داخل المنطقة.",
        },
        text: {
            label: "نص العنوان",
            placeholder: "أدخل هنا النص الذي سيظهر عند التفاعل مع الكائن",
        },
        focusable: {
            label: "قابل للتركيز",
            description: "تركيز الكاميرا على هذه المنطقة عند الدخول.",
            zoomMarginLabel: "هامش التكبير",
            defaultButtonLabel: "التركيز على",
        },
        highlight: {
            label: "تمييز",
            description: "إضافة تأثير تمييز عند دخول المنطقة.",
            opacityLabel: "الشفافية",
            gradientWidthLabel: "عرض التدرج",
            colorLabel: "اللون",
            durationLabel: "مدة الانتقال (بالميلي ثانية)",
        },
        playAudio: {
            label: "تشغيل ملف صوتي",
            description: "تشغيل صوت مع إمكانية ضبط مستوى الصوت.",
            volumeLabel: "مستوى الصوت",
            audioLinkLabel: "رابط الصوت",
            audioLinkPlaceholder: "https://xxx.yyy/smthing.mp3",
            defaultButtonLabel: "تشغيل الموسيقى",
            error: "تعذر تحميل الصوت",
        },
        openWebsite: {
            label: "فتح رابط",
            description: "فتح موقع ويب داخل Universe أو في تبويب جديد.",
            linkLabel: "عنوان الرابط",
            newTabLabel: "فتح في تبويب جديد",
            trigger: "التفاعل",
            triggerMessage: "رسالة منبثقة",
            triggerShowImmediately: "عرض فورًا عند الدخول",
            triggerOnClick: "بدء مصغرًا في الشريط السفلي",
            triggerOnAction: "إظهار إشعار إجراء مع رسالة",
            closable: "قابل للإغلاق",
            allowAPI: "السماح بواجهة Scripting API",
            linkPlaceholder: "https://example.com",
            defaultButtonLabel: "فتح الرابط",
            width: "العرض",
            policy: "سماح iFrame",
            policyPlaceholder: "fullscreen",
            errorEmbeddableLink: "الرابط غير قابل للتضمين",
            messageNotEmbeddableLink: "هذا الرابط غير قابل للتضمين. لا يمكن فتحه إلا في تبويب جديد",
            warningEmbeddableLink: "لا يمكن تضمين هذا الرابط.",
            errorInvalidUrl: 'يرجى إدخال رابط صالح (يبدأ بـ "https://")',
            findOutMoreHere: "اعرف المزيد هنا",
            openPickerSelector: "فتح منتقي العناصر",
            forcedInNewTab: "إجبار على فتح تبويب جديد",
            openApplication: "فتح التطبيق",
        },
        advancedOptions: "خيارات متقدمة",
        speakerMegaphone: {
            label: "المنصة",
            description: 'يمكن للمستخدمين على المنصة (المسرح) التحدث إلى جميع الحاضرين في منطقة "الجمهور" المطابقة.',
            nameLabel: "الاسم",
            namePlaceholder: "المسرح الرئيسي",
            disabled: "المنصة معطلة لهذه الغرفة ❌",
        },
        listenerMegaphone: {
            label: "الجمهور",
            description: "يمكن للمستخدمين في منطقة الجمهور سماع المتحدث على المنصة المرتبطة.",
            nameLabel: "اسم المنصة",
            disabled: "الجمهور معطل لهذه الغرفة ❌",
            waitingMediaLinkLabel: "الوسائط المعروضة قبل بدء البث",
            waitingMediaLinkPlaceholder: "https://www… (أدخل رابط الوسائط)",
            waitingMedialLinkError: "يبدو أن هناك مشكلة في الرابط الذي قدمته. هل يمكنك التحقق منه مرة أخرى؟ 🙏",
            waitingMedialLinkHelp: "يجب أن يكون الرابط الصحيح هو 'https://monlienmedia.com/…'.",
            waitingSpeaker: "بانتظار المتحدث",
        },

        chatEnabled: "ربط قناة دردشة مخصصة",
        start: {
            label: "منطقة البداية",
            description: "مكان يبدأ فيه الأشخاص على الخريطة.",
            nameLabel: "اسم البداية",
            namePlaceholder: "Enter1",
            type: "نوع موضع البداية",
            defaultMenuItem: "استخدام كافتراضي",
            hashMenuItem: "استخدام إذا احتوى الرابط على #[اسم المنطقة]",
            infoAreaName:
                "سيتم استخدام اسم المنطقة في محدد منطقة الخروج. يجب أن يكون فريدًا على الخريطة ولا يمكن أن يحتوي على مسافات أو أحرف خاصة.",
        },
        exit: {
            label: "منطقة الخروج",
            description: "مكان يغادر منه الأشخاص الخريطة إلى أخرى.",
            exitMap: "الخريطة الوجهة",
            exitMapStartAreaName: "اسم منطقة البداية",
            defaultStartArea: "منطقة البداية الافتراضية",
        },
        youtube: {
            label: "فتح فيديو يوتيوب",
            description: "فتح فيديو يوتيوب داخل Universe أو في تبويب جديد.",
            error: "يرجى إدخال رابط يوتيوب صالح",
            disabled: "تم تعطيل تكامل يوتيوب.",
        },
        googleDocs: {
            label: "فتح مستندات جوجل",
            description: "فتح مستندات جوجل داخل Universe أو في تبويب جديد.",
            error: "يرجى إدخال رابط مستندات جوجل صالح",
            disabled: "تم تعطيل تكامل مستندات جوجل.",
        },
        klaxoon: {
            label: "فتح Klaxoon",
            description: "فتح Klaxoon داخل Universe أو في تبويب جديد.",
            error: "يرجى إدخال رابط Klaxoon صالح",
            disabled: "تم تعطيل تكامل Klaxoon.",
        },
        googleSheets: {
            label: "فتح جداول جوجل",
            description: "فتح جداول جوجل داخل Universe أو في تبويب جديد.",
            error: "يرجى إدخال رابط جداول جوجل صالح",
            disabled: "تم تعطيل تكامل جداول جوجل.",
        },
        googleSlides: {
            label: "فتح عروض جوجل",
            description: "فتح عروض جوجل داخل Universe أو في تبويب جديد.",
            error: "يرجى إدخال رابط عروض جوجل صالح",
            disabled: "تم تعطيل تكامل عروض جوجل.",
        },
        eraser: {
            label: "ممحاة",
            description: "مسح كل الرسوم على الخريطة.",
            defaultButtonLabel: "مسح",
            error: "يرجى إدخال رابط ممحاة صالح",
            disabled: "تم تعطيل تكامل الممحاة.",
        },
        googleDrive: {
            label: "فتح Google Drive",
            description: "فتح Google Drive داخل Universe أو في تبويب جديد.",
            error: "يرجى إدخال رابط Google Drive صالح",
            disabled: "تم تعطيل تكامل Google Drive.",
        },
        restrictedRightsPropertyData: {
            label: "إضافة حقوق",
            rightTitle: "حقوق الوصول/التحرير حسب وسم المستخدم",
            rightDescription:
                "الحقوق تحدد من يمكنه التفاعل مع المنطقة. إذا تركتها فارغة فالجميع يمكنه استخدامها. إن وضعتها، فلا يمكن استخدامها إلا لمن لديهم أحد هذه الوسوم.",
            rightWriteTitle: "حقوق التحرير",
            rightWriteDescription:
                "حقوق التحرير تحدد من يمكنه تعديل المنطقة. المستخدمون المطابقون لأحد هذه الوسوم يمكنهم إنشاء أو تحديث أو حذف كائن في المنطقة.",
            rightReadTitle: "حقوق الوصول",
            rightReadDescription:
                "حقوق الوصول تحدد من يمكنه التفاعل مع المنطقة. المستخدمون المطابقون لأحد هذه الوسوم يمكنهم دخول المنطقة واستخدام الكائنات داخلها.",
        },
        personalAreaPropertyData: {
            label: "منطقة شخصية",
            description: "يمكن للمستخدمين المطالبة بمناطق شخصية كمساحتهم الخاصة. كمسؤول، يمكنك تعيين/سحب ملكية منطقة",
            accessClaimMode: "وضع المطالبة بالوصول",
            dynamicAccessClaimMode: "ديناميكي",
            staticAccessClaimMode: "ثابت",
            dynamicAccessDescription: "يمكن لأي شخص لديه وسوم مناسبة المطالبة بملكية المنطقة.",
            staticAccessDescription: "حدد مالك المنطقة يدويًا.",
            allowedTags: "وسوم المستخدمين المسموح بها",
            allowedUser: "مستخدم مسموح",
            owner: "المالك",
            revokeAccess: "سحب الوصول",
        },
        excalidraw: {
            label: "فتح Excalidraw",
            description: "لوحة بيضاء مفتوحة المصدر بأسلوب مرسوم يدويًا. تعاونية ومشفرة طرفًا لطرف.",
            error: "يرجى إدخال رابط Excalidraw صالح",
            disabled: "تم تعطيل تكامل Excalidraw.",
        },
        cards: {
            label: "فتح Cards",
            description: "أسرع وأسهل طريقة لمشاركة المعرفة عبر الإنترنت وعلى Teams والجوال.",
            error: "يرجى إدخال رابط Cards صالح",
            disabled: "تم تعطيل تكامل Cards.",
        },
        tldraw: {
            label: "فتح tldraw",
            description: "لوحة بيضاء / لوحة قماشية لا نهائية SDK.",
            error: "يرجى إدخال رابط tldraw صالح",
            disabled: "تم تعطيل تكامل tldraw.",
        },
        matrixRoomPropertyData: {
            label: "ربط غرفة Matrix",
            description: "اربط غرفة Matrix بمنطقتك",
            openAutomaticallyChatLabel: "فتح الدردشة تلقائيًا",
            roomNameLabel: "اسم عرض الغرفة",
            roomNameLabelPlaceholder: "غرفتي",
            defaultChatRoomAreaName: "منطقة الغرفة",
        },
        tooltipPropertyData: {
            label: "فقاعة معلومات",
            description: "أضف فقاعة معلومات إلى منطقتك ℹ️",
            contentPlaceholder: "اكتب المحتوى هنا ✍️",
            duration: "المدة (بالثواني) ⏱️",
            infinityDuration: "مدة غير محدودة ⏱️",
        },
        openFile: {
            label: "فتح ملف",
            description: "افتح ملفًا داخل Universe.",
            error: "يرجى إدخال ملف صالح",
            disabled: "تم تعطيل تكامل الملفات.",
            fileUrlLabel: "رابط الملف",
            uploadFile: {
                title: "أضف ملفك",
                description: "اسحب وأفلت أو اختر ملفك",
                dragDrop: "اسحب وأفلت أو",
                chooseFile: "اختر ملف",
                errorOnFileFormat: "تنسيق الملف غير مدعوم",
                errorOnFileNumber: "إسقاط ملفات متعددة غير مدعوم",
                errorOnFileSize: "الملف كبير جدًا، الحد الأقصى للحجم هو {size} ميجابايت",
            },
            hideUrlLabel: "إخفاء الرابط",
        },
        livekitRoomProperty: {
            label: "غرفة الاجتماع",
            description: "بدء اجتماع عند الدخول.",
            roomNameLabel: "اسم الغرفة",
            roomNamePlaceholder: "اسم الغرفة",
            highlightAreaOnEnter: "تمييز المنطقة عند الدخول",
            moreOptionsLabel: "خيارات إضافية",
            livekitRoomConfig: {
                addConfig: "إضافة خيار",
                startWithAudioMuted: "بدء مع ميكروفون مكتوم",
                startWithVideoMuted: "بدء مع كاميرا مغلقة",
                disableChat: "تعطيل الدردشة",
                livekitRoomAdminTag: "وسم المشرف لغرفة الاجتماع",
                cancel: "إلغاء",
                validate: "اعتماد",
            },
        },
        noProperties: "لا توجد خصائص محددة",
    },
    areaEditor: {
        editInstructions: "انقر على منطقة لتعديل خصائصها", // Click on an area to edit its properties
        nameLabel: "الاسم", // Name
        nameLabelPlaceholder: "منطقتي", // MyArea
        areaDescription: "الوصف", // Description
        areaDescriptionPlaceholder: "منطقتي هي", // My area is
        areaSerchable: "قابل للبحث في وضع الاستكشاف", // Searchable in exploration mode
        addDescriptionField: "إضافة وصف", // Add description
        clickAgainToSelectAnotherZone: "يمكنك النقر مرة أخرى لتحديد منطقة أخرى", // You can click again to select another zone
        actionPopupOnPersonalAreaWithEntities: {
            title: "إجراء مطلوب", // Action required
            description: "يحتوي هذا المجال الشخصي على كائن واحد أو أكثر. ماذا تريد أن تفعل معه؟", // This personal area contains one or more objects. What would you like to do with it?
            buttons: {
                keep: "احتفظ", // Keep
                remove: "أزل", // Remove
                cancel: "إلغاء", // Cancel
            },
        },
        nameHelpText: "سيتم عرض هذا الاسم للمستخدمين عند دخولهم المنطقة.", // This name will be shown to users when they enter the area.
    },
    areaEditorInstructions: {
        title: "كيف يعمل؟", // How does it work?
        description: "ارسم منطقة على الخريطة لإنشاء منطقة جديدة.", // Draw an area on the map to create a new one.
    },
    entityEditor: {
        header: {
            title: "أضف كائن إلى خريطتك", // Add an object to your map
            description: "ابحث، حمِّل أو اختر كائنًا موجودًا وأضفه إلى الخريطة.", // Search, upload, or select an existing object and add it to the map.
            choose: "اختر كائنًا",
        },
        title: "وضع الكائن", // Place object
        editing: "تعديل: {name}", // Editing: {name}
        itemPicker: {
            searchPlaceholder: "بحث", // Search
            backToSelectObject: "العودة لاختيار الكائن", // Back to select object
        },
        drop: "أسقط ملفك في أي مكان",
        trashTool: {
            delete: "انقر على الكائن لحذفه!", // Click on the object to delete it!
        },
        deleteButton: "حذف", // Delete
        testInteractionButton: "اختبار التفاعل", // Test interaction
        buttonLabel: "تصنيف الأزرار", // Button label
        editInstructions: "انقر على كائن لتعديل خصائصه", // Click on an entity to edit its properties
        selectObject: "انقر على كائن لاختياره", // Click on an object to select it
        objectName: "اسم الكائن", // Object name
        objectNamePlaceholder: "كائني", // MyObject
        objectDescription: "وصف الكائن", // Object description
        objectDescriptionPlaceholder: "كائني هو...", // My object is...
        objectSearchable: "قابل للبحث في وضع الاستكشاف", // Searchable in exploration mode
        addDescriptionField: "إضافة وصف", // Add description
        uploadEntity: {
            title: "إضافة صورة", // Add image
            description: "اسحب وأفلت صورتك أو اخترها لإضافتها إلى الخريطة.", // Drag & drop your image or select it to add it to the map.
            dragDrop: "اسحب وأفلت أو", // Drag and drop or
            chooseFile: "اختر ملف", // Choose file
            errorOnFileFormat: "تنسيق الملف غير مدعوم", // File format not supported
            errorOnFileNumber: "التحميل المتعدد للملفات غير مدعوم", // Multiple file uploads are not supported
        },
        images: "صورة{{s}}", // Image{{s}}
        noImage: "لا توجد صورة", // No image
        customEntityEditorForm: {
            imageName: "اسم الصورة", // Image name
            tags: "وسوم", // Tags
            writeTag: "اكتب وسمًا...",
            objectType: "نوع الكائن", // Object type
            floatingObject: "كائن عائم", // Floating object
            floatingObjectDescription: "يمكن وضع الكائن العائم بحرية على الخريطة. وإلا، سيتم ضبطه على شبكة الخريطة.", // A floating object can be placed freely on the map. Otherwise, it will snap to the map's grid.
            depth: "العمق", // Depth
            groundLevel: "مستوى الأرض", // Ground level
            custom: "مخصص", // Custom
            standing: "واقف", // Standing
            collision: "تصادم",
            wokaAbove: "وكا فوق",
            wokaBelow: "وكا تحت",
        },
        buttons: {
            editEntity: "تعديل الكائن", // Edit entity
            back: "عودة", // Back
            cancel: "إلغاء", // Cancel
            delete: "حذف", // Delete
            save: "حفظ", // Save
            upload: "تحميل", // Upload
        },
        errors: {
            dragNotConnected: "لا يمكنك تحميل الملفات إذا لم تكن مسجلاً الدخول وليس لديك الحقوق اللازمة.",
            dragNotAllowed: "ليست لديك صلاحية لتحميل الملفات على هذه الخريطة",
        },
    },
    settings: {
        loading: "جارٍ التحميل...",
        megaphone: {
            title: "الميغافون",
            description: "الميغافون أداة تتيح لك بث فيديو/صوت لجميع اللاعبين في الغرفة/العالم.",
            inputs: {
                spaceName: "اسم الفضاء",
                spaceNameHelper:
                    "إذا أردت البث لكل المستخدمين عبر غرف مختلفة ضمن نفس العالم، ضع نفس اسم الفضاء لكل إعدادات الميغافون واضبط النطاق على 'العالم'.",
                scope: "النطاق",
                world: "العالم",
                room: "الغرفة",
                rights: "الحقوق",
                rightsHelper:
                    "الحقوق تُحدد من يمكنه استخدام الميغافون. إن تركته فارغًا فالجميع يمكنه استخدامه. وإن وضعته فلا يمكن استخدامه إلا لمن لديه أحد هذه الوسوم.",
                error: {
                    title: "يرجى إدخال عنوان",
                    save: {
                        success: "تم حفظ إعدادات الميغافون",
                        fail: "حدث خطأ أثناء حفظ إعدادات الميغافون",
                    },
                },
            },
        },
        room: {
            title: "إعدادات الغرفة", // Room settings
            description: "قم بتكوين غرفتك", // Configure your room
            inputs: {
                name: "اسم الغرفة", // Room name
                description: "وصف الغرفة", // Room description
                tags: "وسوم", // Tags
                copyright: "ترخيص الغرفة", // Room license
                thumbnail: "صورة مصغرة للغرفة", // Room thumbnail
            },
            helps: {
                description:
                    "وصف للخريطة. يمكن استخدامه في شبكات التواصل الاجتماعي عند مشاركة رابط الخريطة. // A description of the map. Can be used on social networks when sharing a map link.",
                tags: "قائمة من الوسوم. يمكن استخدامها لمنح الوصول إلى الخريطة. // A list of tags. Can be used to grant access to the map.",
                thumbnail:
                    "رابط إلى صورة مصغرة. تُستخدم هذه الصورة في شبكات التواصل الاجتماعي عند مشاركة رابط الخريطة. // URL to a thumbnail image. This image is used on social networks when sharing a map link.",
                copyright:
                    "إشعار حقوق الطبع والنشر لهذه الخريطة. يمكن أن يكون رابطًا لترخيص. قد تحتوي أجزاء من هذه الخريطة مثل مجموعات البلاط أو الصور على حقوق طبع ونشر خاصة بها. // Copyright notice for this map. Can be a link to a license. Parts of this map like tilesets or images may have their own copyrights.",
            },
            actions: {
                save: "حفظ", // Save
                confirm: "تأكيد", // Confirm
                success: "تم حفظ إعدادات الغرفة", // Room settings saved
                error: "خطأ في حفظ إعدادات الغرفة", // Error saving room settings
            },
            confirmSave:
                "أكد أنك تريد حفظ التغييرات على الخريطة. سيؤدي هذا إلى إنشاء إصدار جديد من الخريطة، وفصل جميع اللاعبين، وإعادة تحميل الخريطة لجميع اللاعبين.", // Confirm that you want to save changes to the map. This will create a new version of the map, disconnect all players, and reload the map for all players.
        },
    },
    explorer: {
        title: "استكشاف الغرفة", // Explore room
        description:
            "يسمح باستكشاف الغرفة. يمكنك التحرك في الغرفة والتفاعل مع الكائنات. هناك وضعان: 'استكشاف' و 'بحث'. في 'وضع البحث'، يمكنك البحث عن الكيانات والمناطق في الغرفة أو تصفيتها. في 'وضع الاستكشاف'، يمكنك التحرك بحرية في الغرفة.", // Allows exploring the room. You can move around the room and interact with objects. There are 2 modes: 'Exploration' and 'Search'. In 'Search mode', you can search for entities and areas in the room or filter them. In 'Exploration mode', you can move freely in the room.
        noEntitiesFound: "لم يتم العثور على كائن في الغرفة 🙅‍♂️", // No entity found in the room 🙅‍♂️
        entitiesFound: "تم العثور على {{s}} كائنات", // {{s}} objects found
        noAreasFound: "لم يتم العثور على منطقة في الغرفة 🙅‍♀️", // No area found in the room 🙅‍♀️
        areasFound: "تم العثور على {{s}} مناطق", // {{s}} areas found
        noDescriptionFound: "لم يتم العثور على وصف 🫥", // No description found 🫥
        details: {
            close: "إغلاق", // Close
            moveToEntity: "الانتقال إلى الكائن {name}", // Move to entity {name}
            moveToArea: "الانتقال إلى المنطقة {name}", // Move to area {name}
            errorMovingToObject: "الكائن غير متاح بعد 🚫", // The object is not accessible yet 🚫
        },
        zoomIn: "تكبير", // Zoom In +
        zoomOut: "تصغير", // Zoom Out -
        showMyLocation: "إظهار موقعي", // Show my location
    },
    edit: {
        bots: {
            page: {
                voice: {
                    title: "الصوت",
                    offDoor: "متوقف · امنح {bot} صوتًا",
                    notAllowedBrief: "متوقف في هذا الكون",
                    noServiceBrief: "غير متاح هنا بعد",
                    loading: "جارٍ التحميل…",
                    loadFailed: "تعذّر تحميل إعدادات الصوت.",
                    briefOn: "{voice} · {style} · {payer}",
                    payerUniverseAi: "ذكاء Universe",
                    payerYourKeys: "مفاتيحك",
                    payerTheirKeys: "مفاتيح {maker}",
                    payerUniverseAiAndYourKey: "ذكاء Universe ومفتاحك",
                    payerUniverseAiAndTheirKey: "ذكاء Universe ومفتاح {maker}",
                    makerFallback: "صانع البوت",
                    yourKey: "مفتاحك",
                    theirKey: "مفتاح {maker}",
                    pausedCredit: "متوقف مؤقتًا · رصيد {key} انتهى",
                    pausedKey: "متوقف مؤقتًا · {key} لا يعمل",
                    pausedGone: "متوقف مؤقتًا · {key} لم يعد مُعارًا هنا",
                    pausedUniverseAi: "متوقف مؤقتًا · صوت ذكاء Universe متوقف",
                    keyMine: "مفتاحك لدى {company} ••••{last4}",
                    keyMineShort: "مفتاحك لدى {company}",
                    keyMineMidShort: "مفتاحك لدى {company}",
                    keyTheirsShort: "مفتاح {owner} لدى {company}",
                    keyTheirs: "مفتاح {owner} لدى {company} ••••{last4}",
                    keyFallbackMine: "مفتاح الصوت الخاص بك",
                    keyFallbackTheirs: "مفتاح الصوت الخاص بـ {owner}",
                    style: {
                        restrained: "هادئ",
                        natural: "طبيعي",
                        expressive: "معبّر",
                    },
                    styleHint: {
                        restrained: "هادئ ومتزن، بقليل من الانفعال.",
                        natural: "نبرة وإيقاع طبيعيان. بلا ضحكات أو تنهدات مصطنعة.",
                        expressive: "مدى أوسع للشخصيات. ضحكات وتنهدات عند الحاجة فقط.",
                    },
                    switchTitle: "يتحدث في الفقاعات",
                    switchHint: "من في فقاعته يستطيع التحدث معه وسماعه. تبقى المحادثة النصية كما هي.",
                    switchHintLocked: "من في فقاعته يستطيع التحدث معه وسماعه.",
                    switchLabel: "الصوت",
                    doorLead: "اختر صوتًا ليستطيع من بجانب {bot} التحدث معه بصوت مسموع. تبقى المحادثة النصية كما هي.",
                    doorVoices: "الأصوات",
                    doorVoicesOn: "الأصوات على {key}",
                    paidByKey: "الدفع عبر {key}",
                    paidByUniverseAi: "الدفع عبر ذكاء Universe",
                    usedBefore: "استُخدم سابقًا",
                    allVoices: "كل الأصوات",
                    allVoicesLine: "ابحث في {count} صوت بالاسم أو اللغة",
                    allVoicesLineMore: "ابحث في كل الأصوات بالاسم أو اللغة",
                    useVoice: "استخدم صوت {voice}",
                    doorNoteUniverseAi:
                        "مجاني لك. يحصل كل شخص على ما يصل إلى {replies} رد صوتي كل {hours} ساعات، ثم يجيبه {bot} بالنص.",
                    onNoteUniverseAi: "مجاني لك. يحصل كل شخص على ما يصل إلى {replies} رد صوتي كل {hours} ساعات.",
                    notAllowedTitle: "البوتات الصوتية متوقفة في هذا الكون",
                    notAllowedLine:
                        "يستطيع المشرف تشغيل «السماح بالبوتات الصوتية» من إعدادات الكون. يبقى {bot} يتحدث بالنص.",
                    universeSettings: "إعدادات الكون",
                    noServiceTitle: "لم يُجهَّز أي صوت هنا بعد",
                    noServiceLine: "يبقى {bot} يتحدث بالنص. يتحول هذا الصف إلى قائمة أصوات تلقائيًا عندما يتوفر الصوت.",
                    noServiceLineMaker:
                        "ليس لدى Universe AI صوت هنا بعد. أضف مفتاح صوت من مفاتيح الذكاء الاصطناعي وأعِره لهذا الكون: يكفي مفتاح واحد من شركة تستمع وتتكلم، أو استخدم شركتين. يبقى {bot} يتحدث بالنص حتى ذلك الحين.",
                    addVoiceKeys: "أضف مفتاح صوت",
                    askUniverseAi: "ذكاء Universe",
                    askUniverseAiLine: "كل شخص يستخدم ردوده الصوتية الخاصة: حتى {replies} كل {hours} ساعات.",
                    askKeyLine: "أنت تدفع؛ ومن يتحدث مع {bot} لا يدفع شيئًا.",
                    askKeyLineTheirs: "{owner} يدفع؛ ومن يتحدث مع {bot} لا يدفع شيئًا.",
                    firstOnUniverseAi: "{bot} يتحدث في الفقاعات الآن بصوت {voice}.",
                    firstOnKey: "{bot} يتحدث في الفقاعات الآن بصوت {voice} عبر {key}.",
                    cardCaption: "الصوت",
                    hear: "استمع إلى {voice}",
                    noSample: "لا توجد عيّنة لصوت {voice}",
                    sampleFailed: "تعذّر تشغيل العيّنة. حاول مرة أخرى.",
                    helloTitle: "استمع إلى هذا الصوت يقول مرحبًا",
                    helloLineUniverseAi:
                        "جملة قصيرة لسماع هذا الصوت. تستهلك ردًّا صوتيًّا واحدًا من ردودك، وإعادة سماعها قريبًا مجانية.",
                    helloLineKey: "جملة قصيرة لسماع هذا الصوت. تستهلك بضعة أحرف من {key}، وإعادة سماعها قريبًا مجانية.",
                    helloThinking: "جارٍ تجهيز الصوت…",
                    helloSaying: "الصوت يقول مرحبًا…",
                    helloStop: "إيقاف",
                    helloUsedUp: "انتهت ردودك الصوتية حتى {time}. تبقى العيّنات أعلاه تعمل مجانًا.",
                    helloFailed: "تعذّر تشغيل الصوت الآن. حاول مرة أخرى.",
                    change: "تغيير",
                    howItSpeaks: "طريقة الكلام",
                    payerUniverseAiTitle: "ذكاء Universe يدفع تكلفة الاستماع والكلام.",
                    payerUniverseAiNote:
                        "كل شخص يستخدم ردوده الصوتية الخاصة: حتى {replies} كل {hours} ساعات، ثم يكملون المحادثة بالنص.",
                    payerKeysTitle: "{speaks} يتكلم. {listens} يستمع.",
                    payerKeySpeaksTitle: "{speaks} يتكلم. ذكاء Universe يستمع.",
                    payerKeyListensTitle: "ذكاء Universe يتكلم. {listens} يستمع.",
                    payerBothKeyLine: "يستمع ويتكلم. أنت تدفع؛ ومن يتحدث مع {bot} لا يدفع شيئًا.",
                    payerBothKeyLineTheirs: "يستمع ويتكلم. {owner} يدفع؛ ومن يتحدث مع {bot} لا يدفع شيئًا.",
                    payerBothUniverseAiLine:
                        "يستمع ويتكلم. كل شخص يستخدم ردوده الصوتية الخاصة: حتى {replies} كل {hours} ساعات.",
                    payerSplitTitle: "{listens} يستمع. {speaks} يتكلم.",
                    payerTwoKeysLine: "شركتان، وأنت تدفع للاثنتين. من يتحدث مع {bot} لا يدفع شيئًا.",
                    payerTwoKeysLineTheirs: "شركتان، و{owner} يدفع للاثنتين. من يتحدث مع {bot} لا يدفع شيئًا.",
                    bothCaption: "شركة واحدة للمهمتين",
                    bothKeyCard: "يستمع ويتكلم · أنت تدفع",
                    bothKeyCardTheirs: "يستمع ويتكلم · {owner} يدفع",
                    bothUniverseAiCard: "يستمع ويتكلم · يستخدم الأشخاص ردودهم الصوتية الخاصة",
                    split: "افصل الاستماع عن الكلام",
                    splitLine: "استمع عبر شركة وتكلّم عبر أخرى",
                    listensWith: "يستمع عبر",
                    speaksWith: "يتكلم عبر",
                    whySplit: "لماذا الفصل؟",
                    whySplitLine:
                        "كل شركة تسعّر المهمتين بشكل مستقل: الاستماع بالدقائق التي يتحدث فيها الناس، والكلام بما يقوله {bot}. قد يكون الرصيد المجاني أو السعر الأقل أو الصوت الذي يعجبك لدى شركة مختلفة لكل مهمة.",
                    payerKeyNote: "من يتحدث مع {bot} لا يدفع شيئًا. هذا الشهر: {replies} رد صوتي على هذا المفتاح.",
                    limitsLine: "الرد المنطوق حتى {seconds} ثانية. يستمع لاسمه حتى {minutes} دقيقة في اليوم.",
                    limitsYourKey: " هذه حدود مفتاحك.",
                    limitsTheirKey: " هذه حدود مفتاح {maker}.",
                    coManager:
                        "فقط مفاتيح {maker} أو ذكاء Universe تستطيع دفع تكلفة صوت {bot}، لأن {maker} هو من صنعه. مفاتيحك تعمل على البوتات التي صنعتها.",
                    more: "المزيد من إعدادات الصوت",
                    moreLine: "اللغة، من يدفع، الإصدارات",
                    moreLineModel: "اللغة، من يدفع، النموذج، الإصدارات",
                    whoPays: "من يدفع",
                    modelRow: "{title} · {model}",
                    universeAiPicks:
                        "يختار ذكاء Universe طريقة استماع {bot} وكلامه ويُبقيها محدّثة. لتدفع تكلفة صوت {bot} بنفسك، أضف مفتاح صوت من مفاتيح الذكاء الاصطناعي.",
                    speaksOn: "يتكلم عبر",
                    speakingModel: "نموذج الكلام",
                    listensOn: "يستمع عبر",
                    listeningModel: "نموذج الاستماع",
                    talkingModel: "نموذج المحادثة المباشرة",
                    talkingModelHint: "يستمع ويتكلم في اتصال مباشر واحد. عقل {bot} يكتب كل إجابة، بالصوت والنص.",
                    talksLive: "يتحدث مباشرة",
                    payerTalksLiveTitle: "{key} يستمع ويتكلم مباشرة، في نموذج واحد.",
                    payerTalksLive: "{key} يستمع ويتكلم مباشرة. عقل {bot} يكتب كل إجابة، بالصوت والنص.",
                    universeAiPeople: "يستخدم الأشخاص ردودهم الصوتية الخاصة",
                    universeAiListens: "مجاني لمن يتحدث معه",
                    keyYouPay: "أنت تدفع · مُعار لهذا الكون",
                    keyOwnerPays: "{owner} يدفع · مُعار لهذا الكون",
                    language: "اللغة",
                    languageFollow: "لغة كل شخص",
                    languageOne: "دائمًا لغة واحدة",
                    languageFollowHint: "يسمع {bot} ويجيب بلغة كل شخص يتحدث: العربية أو الإنجليزية أو كلتيهما.",
                    languageOneHint:
                        "يستمع {bot} إليها ويجيب بها دائمًا. اختر هذا إن كان أغلب من هنا يتحدثون لغة واحدة ويسيء {bot} فهمهم.",
                    languageAlways: "دائمًا {language}",
                    languageAlwaysHint: "يستمع {bot} إلى اللغة {language} ويجيب دائمًا باللغة {language}.",
                    versions: "الإصدارات",
                    version: "الإصدار {number} · {voice} · {style} · {payer}",
                    versionWhen: "{when} · {who}",
                    versionWhenOnly: "{when}",
                    today: "اليوم {time}",
                    speakingNow: "يتكلم الآن",
                    rollBack: "الرجوع إليه",
                    versionsLine:
                        "كل تغيير يُحفظ كإصدار جديد. الرجوع إلى إصدار يعطي المحادثات الجديدة الصوت القديم؛ أما الجارية فتحتفظ بصوتها.",
                    rolledBack:
                        "رجعنا إلى الإصدار {number}. تستخدمه المحادثات الجديدة؛ أما الجارية فتنتهي بالصوت الذي بدأت به.",
                    saveFailed: "تعذّر الحفظ. {reason}",
                    saving: "جارٍ الحفظ…",
                    keyDownCredit: "{key} نفد رصيده الساعة {time}",
                    keyDownCreditNoTime: "{key} نفد رصيده",
                    keyDownRejected: "{key} رفضته الشركة",
                    keyDownModel: "{key} لم يعد يستطيع استخدام نموذجه",
                    keyDownErrors: "{key} لا يستجيب",
                    keyDownOther: "{key} لا يعمل",
                    keyDownLine:
                        "يجيب {bot} بالنص إلى أن يعمل المفتاح مجددًا. لا ينتقل إلى صوت ذكاء Universe من تلقاء نفسه. تتم إعادة المحاولة كل 5 دقائق.",
                    checkNow: "تحقق الآن",
                    aiKeys: "مفاتيح الذكاء الاصطناعي",
                    keyGoneTitle: "{key} لم يعد مُعارًا لهذا الكون",
                    keyGoneLine:
                        "يجيب {bot} بالنص. أعِر المفتاح هنا مجددًا من مفاتيح الذكاء الاصطناعي، أو اختر صوتًا من ذكاء Universe.",
                    keyGoneLineTheirs:
                        "يجيب {bot} بالنص. يستطيع {maker} إعارة المفتاح هنا مجددًا، أو يمكنك اختيار صوت من ذكاء Universe.",
                    useUniverseAi: "استخدم صوتًا من ذكاء Universe",
                    universeAiOffTitle: "صوت ذكاء Universe متوقف على هذا الخادم حاليًا",
                    universeAiOffLine: "يجيب {bot} بالنص ويعود للكلام تلقائيًا عند عودته. لا يلزمك فعل شيء.",
                    back: "الصوت",
                    pickerTitleUniverseAi: "أصوات {bot} على ذكاء Universe",
                    pickerTitleKey: "أصوات {bot} على {key}",
                    searchPlaceholder: "ابحث في {count} صوت",
                    searchLabel: "ابحث في الأصوات",
                    anyLanguage: "أي لغة",
                    languageLabel: "اللغة",
                    samplesLine: "العيّنات من شركة الصوت نفسها، مجانًا.",
                    noVoices: "لا يوجد صوت مطابق.",
                    voicesLoading: "جارٍ تحميل الأصوات…",
                    voicesFailed: "تعذّر تحميل الأصوات.",
                    retry: "حاول مرة أخرى",
                    moreVoicesTitle: "أصوات أكثر بمفتاح الصوت الخاص بك",
                    moreVoicesLine:
                        "أضف مفتاح صوت من أي شركة يتيحها هذا الخادم في مفاتيح الذكاء الاصطناعي، وأعِره هنا. تدفع أنت تكلفة صوت {bot} عليه؛ ولا تُستهلك ردود أي شخص.",
                    keep: "رجوع",
                    use: "استخدم {voice}",
                    ownServerMine: "خادم الكلام الخاص بك",
                    ownServerMineStart: "خادم الكلام الخاص بك",
                    ownServerTheirs: "خادم الكلام الخاص بـ {owner}",
                    payerOwnTitle: "يعمل على {server}",
                    payerOwnLine: "يستمع ويتكلم. لا تُدفع أي شركة صوت، ومن يتحدث مع {bot} لا يدفع شيئًا.",
                    helloLineOwn: "جملة قصيرة يقولها {server}. مجانًا: لا تُدفع أي شركة صوت.",
                    helloTitleNamed: "استمع إلى {voice} يقول مرحبًا",
                    cardAboutTyped: "اسم مكتوب لـ {server}",
                    typedCaption: "الصوت على {server}",
                    typedTitle: "صوت {bot} على {server}",
                    typedLabel: "اسم الصوت",
                    typedPlaceholder: "اسم الصوت، مثل af_heart",
                    typedHelp: "{server} لا يعرض أصواته. اكتب اسم الصوت تمامًا كما يستخدمه خادمك.",
                    useThisVoice: "استخدم هذا الصوت",
                    checkingVoice: "جارٍ التحقق من {voice}…",
                    voiceNameRejected:
                        "لم يقبل {server} «{voice}» كاسم صوت. تحقق من طريقة كتابته في خادمك ثم حاول مرة أخرى.",
                    speechServerSilent: "لم يستجب {server}. هل هو يعمل والنفق متصل؟",
                },
            },
        },
    },
    listRoom: {
        isFetching: "جارٍ تحميل قائمة الغرف... ⤵️", // Fetching room list... ⤵️
        noRoomFound: "لم يتم العثور على غرفة 🙅‍♂️", // No room found 🙅‍♂️
        items: "{countEntity} كائنات / {countArea} مناطق", // {countEntity} entities / {countArea} areas
        close: "إغلاق", // Close
        movingToRoom: "الانتقال إلى الغرفة: {roomNameSelected}... إلى اللقاء... 🫡", // Moving to room: {roomNameSelected}... See you soon... 🫡
        searchLabel: "ابحث عن غرفة", // Search for a room
        searchPlaceholder: "اكتب...", // Type...
    },
};

export default mapEditor;
