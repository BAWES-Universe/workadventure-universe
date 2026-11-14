import type { NoteLanguage } from './BotStatusNotes';

/**
 * A key typed into a Brick's chat (Keys for Apps, game #2044). Keys are added on the safe form, never in chat: a key in chat would sit
 * in the conversation, in the model's input and in the Brick's memory. A message that holds something shaped like a key from a
 * known provider is not answered, is not remembered and never reaches the model; the Brick says where keys go instead.
 *
 * The shapes are deliberately narrow (named providers, long bearer tokens). The message box in the game holds back the same shapes before
 * they are sent (play/src/front/Chat/Bricks/Apps/KeyShapes.ts): keep the two lists the same.
 */
const KEY_SHAPES: RegExp[] = [
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{12,}\b/,
    /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/,
    /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
];

export function holdsAKey(text: string | undefined | null): boolean {
    if (!text) return false;
    return KEY_SHAPES.some((shape) => shape.test(text));
}

const WORDS: Record<NoteLanguage, string> = {
    en: "That looks like a key, so I didn't read it and it isn't saved. Keys don't go in chat. Ask me to connect the app and I'll give you a safe form to put it in.",
    ar: 'يبدو هذا كمفتاح، لذلك لم أقرأه ولم يُحفظ. المفاتيح لا توضع في الدردشة. اطلب مني ربط التطبيق وسأعطيك نموذجًا آمنًا لإدخاله.',
    ca: "Això sembla una clau, així que no l'he llegida i no s'ha desat. Les claus no van al xat. Demana'm que connecti l'aplicació i et donaré un formulari segur per posar-la.",
    de: 'Das sieht nach einem Schlüssel aus, deshalb habe ich es nicht gelesen und es ist nicht gespeichert. Schlüssel gehören nicht in den Chat. Bitte mich, die App zu verbinden, dann bekommst du ein sicheres Formular dafür.',
    es: 'Eso parece una clave, así que no la leí y no se guardó. Las claves no van en el chat. Pídeme que conecte la app y te daré un formulario seguro para ponerla.',
    fr: "Cela ressemble à une clé : je ne l'ai pas lue et elle n'est pas enregistrée. Les clés ne vont pas dans le chat. Demande-moi de connecter l'app et je te donnerai un formulaire sûr pour la saisir.",
    it: 'Sembra una chiave, quindi non l\'ho letta e non è stata salvata. Le chiavi non vanno nella chat. Chiedimi di collegare l\'app e ti darò un modulo sicuro dove inserirla.',
    ja: 'これはキーのようなので、読まず、保存もしていません。キーはチャットには入力しないでください。アプリの接続を頼んでくれれば、安全なフォームをお渡しします。',
    ko: '키처럼 보여서 읽지 않았고 저장하지도 않았어요. 키는 채팅에 입력하지 마세요. 앱을 연결해 달라고 하시면 안전한 입력 양식을 드릴게요.',
    nl: 'Dat lijkt op een sleutel, dus ik heb het niet gelezen en het is niet opgeslagen. Sleutels horen niet in de chat. Vraag me de app te koppelen en je krijgt een veilig formulier om hem in te vullen.',
    pt: 'Isso parece uma chave, então não li e não foi guardada. Chaves não vão no chat. Peça para eu conectar o app e eu te dou um formulário seguro para colocá-la.',
    zh: '这看起来像是密钥，所以我没有读取，也没有保存。密钥不要发在聊天里。请让我连接这个应用，我会给你一个安全的表单来填写。',
};

/** What the Brick says in the person's language when a key was typed into the chat. */
export function keyInChatReply(language: NoteLanguage): string {
    return WORDS[language] ?? WORDS.en;
}
