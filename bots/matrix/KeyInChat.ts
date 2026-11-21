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
    en: "That looks like a key, so I didn't read it or keep it. The message is still in this chat, though: please delete it and change that key, because anyone who can see it could use it. Keys don't go in chat. Ask me to connect the app and I'll give you a safe form for the new one.",
    ar: "يبدو هذا كمفتاح، لذلك لم أقرأه ولم أحتفظ به. لكن الرسالة ما زالت في هذه الدردشة: يرجى حذفها وتغيير ذلك المفتاح، لأن أي شخص يراها يمكنه استخدامه. المفاتيح لا توضع في الدردشة. اطلب مني ربط التطبيق وسأعطيك نموذجًا آمنًا للمفتاح الجديد.",
    ca: "Això sembla una clau, així que no l'he llegida ni l'he conservada. Però el missatge continua en aquest xat: esborra'l i canvia aquesta clau, perquè qualsevol que el vegi podria fer-la servir. Les claus no van al xat. Demana'm que connecti l'aplicació i et donaré un formulari segur per a la nova.",
    de: "Das sieht nach einem Schlüssel aus, deshalb habe ich es nicht gelesen und nicht behalten. Die Nachricht steht aber noch in diesem Chat: Lösche sie bitte und ändere den Schlüssel, denn jeder, der sie sieht, könnte ihn nutzen. Schlüssel gehören nicht in den Chat. Bitte mich, die App zu verbinden, dann bekommst du ein sicheres Formular für den neuen.",
    es: "Eso parece una clave, así que no la leí ni la conservé. Pero el mensaje sigue en este chat: bórralo y cambia esa clave, porque cualquiera que lo vea podría usarla. Las claves no van en el chat. Pídeme que conecte la app y te daré un formulario seguro para la nueva.",
    fr: "Cela ressemble à une clé : je ne l'ai pas lue et je ne l'ai pas gardée. Mais le message est toujours dans ce chat : supprime-le et change cette clé, car toute personne qui le voit pourrait l'utiliser. Les clés ne vont pas dans le chat. Demande-moi de connecter l'app et je te donnerai un formulaire sûr pour la nouvelle.",
    it: "Sembra una chiave, quindi non l'ho letta né conservata. Ma il messaggio è ancora in questa chat: eliminalo e cambia quella chiave, perché chiunque lo veda potrebbe usarla. Le chiavi non vanno nella chat. Chiedimi di collegare l'app e ti darò un modulo sicuro per quella nuova.",
    ja: "これはキーのようなので、読まず、保存もしていません。ただ、そのメッセージはこのチャットに残っています。見える人なら誰でも使えてしまうので、メッセージを削除して、そのキーを新しいものに変更してください。キーはチャットには入力しないでください。アプリの接続を頼んでくれれば、新しいキー用の安全なフォームをお渡しします。",
    ko: "키처럼 보여서 읽지 않았고 보관하지도 않았어요. 하지만 그 메시지는 아직 이 채팅에 남아 있어요. 보이는 사람은 누구나 쓸 수 있으니 메시지를 삭제하고 그 키를 새로 바꿔 주세요. 키는 채팅에 입력하지 마세요. 앱을 연결해 달라고 하시면 새 키를 넣을 안전한 양식을 드릴게요.",
    nl: "Dat lijkt op een sleutel, dus ik heb het niet gelezen en niet bewaard. Het bericht staat wel nog in deze chat: verwijder het en vervang die sleutel, want iedereen die het ziet kan hem gebruiken. Sleutels horen niet in de chat. Vraag me de app te koppelen en je krijgt een veilig formulier voor de nieuwe.",
    pt: "Isso parece uma chave, então não li nem guardei. Mas a mensagem continua neste chat: apague-a e troque essa chave, porque qualquer pessoa que a veja poderia usá-la. Chaves não vão no chat. Peça para eu conectar o app e eu te dou um formulário seguro para a nova.",
    zh: "这看起来像是密钥，所以我没有读取，也没有保存。不过这条消息仍然留在这个聊天里：请删除它并更换该密钥，因为任何看到它的人都可能使用它。密钥不要发在聊天里。请让我连接这个应用，我会给你一个安全的表单来填写新密钥。",
};

/** What the Brick says in the person's language when a key was typed into the chat. */
export function keyInChatReply(language: NoteLanguage): string {
    return WORDS[language] ?? WORDS.en;
}
