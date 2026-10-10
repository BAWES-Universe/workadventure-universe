import type { BotConfiguration } from '../server/AdminApiService';

/**
 * Plain notes a bot leaves in a direct chat when it can't answer, so nobody mistakes a resting or deleted bot for a
 * bug. The game draws them as a status card from the `universe.bot_status` field; other Matrix apps show the body.
 * Notes follow the language of the person's message, guessed offline from its script and common words.
 */

export const BOT_STATUS_KEY = 'universe.bot_status';

/** What a person sees about a bot before they write: the chat header and the People list. */
export type BotAvailability = 'online' | 'resting' | 'unready' | 'gone';

/** Why the bot left a note instead of an answer. */
export type BotNoteState = 'resting' | 'unready' | 'trouble' | 'gone' | 'no_access';

export type NoteLanguage = 'en' | 'ar' | 'ca' | 'de' | 'es' | 'fr' | 'it' | 'ja' | 'ko' | 'nl' | 'pt' | 'zh';

export function availabilityOf(config: BotConfiguration | null): BotAvailability {
    if (!config) return 'gone';
    if (config.enabled === false) return 'resting';
    if (!config.aiProviderRef) return 'unready';
    return 'online';
}

interface NoteWords {
    /** Short heading on the game's card. */
    title: string;
    /** The sentence itself. `{name}` is the bot's name. */
    text: string;
    /** Opening for apps without the card, when the sentence does not already name the bot. */
    lead?: string;
}

const NOTES: Record<NoteLanguage, Record<BotNoteState, NoteWords>> = {
    en: {
        resting: { title: 'Resting', lead: '{name} is resting.', text: "The bot's owner turned it off for now, so it can't reply until it's back on." },
        unready: { title: 'Not ready yet', lead: "{name} isn't ready to chat yet.", text: "The bot's owner still needs to finish setting it up. Try again another day." },
        trouble: { title: "Couldn't answer", text: "{name} couldn't answer that just now. Send it again in a minute." },
        gone: { title: 'Gone', text: "{name} isn't around anymore. The bot was removed, so this chat is closed." },
        no_access: { title: "Can't chat", text: "You can chat with {name} once you can visit the bot's room." },
    },
    ar: {
        resting: { title: 'في استراحة', lead: '{name} في استراحة.', text: 'أوقف صاحب البوت تشغيله مؤقتًا، لذلك لا يستطيع الرد حتى يعود.' },
        unready: { title: 'ليس جاهزًا بعد', lead: '{name} ليس جاهزًا للدردشة بعد.', text: 'ما زال على صاحب البوت إكمال إعداده. حاول مرة أخرى في يوم آخر.' },
        trouble: { title: 'تعذّر الرد', text: 'لم يتمكن {name} من الرد على ذلك الآن. أرسلها مرة أخرى بعد دقيقة.' },
        gone: { title: 'غادر', text: '{name} لم يعد موجودًا. تمت إزالة البوت، لذلك أُغلقت هذه الدردشة.' },
        no_access: { title: 'لا يمكن الدردشة', text: 'يمكنك الدردشة مع {name} عندما تتمكن من زيارة غرفة البوت.' },
    },
    ca: {
        resting: { title: 'Descansant', lead: '{name} està descansant.', text: "El propietari del bot l'ha apagat de moment, així que no pot respondre fins que torni a estar actiu." },
        unready: { title: 'Encara no està a punt', lead: '{name} encara no està a punt per xatejar.', text: "El propietari del bot encara ha d'acabar de configurar-lo. Torna-ho a provar un altre dia." },
        trouble: { title: 'No ha pogut respondre', text: "{name} no ha pogut respondre ara mateix. Torna a enviar-ho d'aquí a un minut." },
        gone: { title: "Se n'ha anat", text: "{name} ja no hi és. El bot s'ha eliminat, així que aquest xat està tancat." },
        no_access: { title: 'No pots xatejar', text: 'Podràs xatejar amb {name} quan puguis visitar la sala del bot.' },
    },
    de: {
        resting: { title: 'Pause', lead: '{name} macht gerade Pause.', text: 'Der Besitzer des Bots hat ihn vorerst ausgeschaltet, deshalb kann er erst antworten, wenn er wieder an ist.' },
        unready: { title: 'Noch nicht bereit', lead: '{name} ist noch nicht bereit zum Chatten.', text: 'Der Besitzer des Bots muss ihn noch fertig einrichten. Versuch es an einem anderen Tag noch einmal.' },
        trouble: { title: 'Keine Antwort', text: '{name} konnte gerade nicht antworten. Schick die Nachricht in einer Minute noch einmal.' },
        gone: { title: 'Weg', text: '{name} ist nicht mehr da. Der Bot wurde entfernt, deshalb ist dieser Chat geschlossen.' },
        no_access: { title: 'Kein Chat möglich', text: 'Du kannst mit {name} chatten, sobald du den Raum des Bots besuchen kannst.' },
    },
    es: {
        resting: { title: 'Descansando', lead: '{name} está descansando.', text: 'El dueño del bot lo ha apagado por ahora, así que no puede responder hasta que vuelva a estar activo.' },
        unready: { title: 'Aún no está listo', lead: '{name} aún no está listo para chatear.', text: 'El dueño del bot todavía tiene que terminar de configurarlo. Inténtalo otro día.' },
        trouble: { title: 'No pudo responder', text: '{name} no pudo responder a eso ahora mismo. Envíalo de nuevo en un minuto.' },
        gone: { title: 'Se fue', text: '{name} ya no está. El bot fue eliminado, así que este chat está cerrado.' },
        no_access: { title: 'No puedes chatear', text: 'Podrás chatear con {name} cuando puedas visitar la sala del bot.' },
    },
    fr: {
        resting: { title: 'En pause', lead: '{name} est en pause.', text: "Le propriétaire du bot l'a désactivé pour le moment, il ne peut donc pas répondre avant d'être réactivé." },
        unready: { title: 'Pas encore prêt', lead: "{name} n'est pas encore prêt à discuter.", text: 'Le propriétaire du bot doit encore finir de le configurer. Réessayez un autre jour.' },
        trouble: { title: 'Pas de réponse', text: "{name} n'a pas pu répondre pour l'instant. Renvoyez votre message dans une minute." },
        gone: { title: 'Parti', text: "{name} n'est plus là. Le bot a été supprimé, cette discussion est donc fermée." },
        no_access: { title: 'Discussion impossible', text: 'Vous pourrez discuter avec {name} dès que vous pourrez visiter la salle du bot.' },
    },
    it: {
        resting: { title: 'In pausa', lead: '{name} è in pausa.', text: "Il proprietario del bot l'ha spento per ora, quindi non può rispondere finché non torna attivo." },
        unready: { title: 'Non ancora pronto', lead: '{name} non è ancora pronto a chattare.', text: 'Il proprietario del bot deve ancora finire di configurarlo. Riprova un altro giorno.' },
        trouble: { title: 'Nessuna risposta', text: '{name} non è riuscito a rispondere in questo momento. Rimanda il messaggio tra un minuto.' },
        gone: { title: 'Andato via', text: "{name} non c'è più. Il bot è stato rimosso, quindi questa chat è chiusa." },
        no_access: { title: 'Chat non disponibile', text: 'Potrai chattare con {name} quando potrai visitare la stanza del bot.' },
    },
    ja: {
        resting: { title: 'お休み中', lead: '{name}はお休み中です。', text: 'ボットのオーナーが一時的にオフにしているため、オンに戻るまで返信できません。' },
        unready: { title: '準備中', lead: '{name}はまだチャットの準備ができていません。', text: 'ボットのオーナーがまだ設定を終えていません。別の日にもう一度お試しください。' },
        trouble: { title: '返信できませんでした', text: '{name}は今は返信できませんでした。1分後にもう一度送ってください。' },
        gone: { title: 'いなくなりました', text: '{name}はもういません。ボットが削除されたため、このチャットは終了しました。' },
        no_access: { title: 'チャットできません', text: 'ボットのルームを訪れられるようになると、{name}とチャットできます。' },
    },
    ko: {
        resting: { title: '휴식 중', lead: '{name}은(는) 휴식 중이에요.', text: '봇 주인이 잠시 꺼 두어서 다시 켜질 때까지 답할 수 없어요.' },
        unready: { title: '아직 준비 중', lead: '{name}은(는) 아직 채팅할 준비가 안 됐어요.', text: '봇 주인이 아직 설정을 마치지 않았어요. 다른 날 다시 시도해 주세요.' },
        trouble: { title: '답하지 못했어요', text: '{name}이(가) 지금은 답하지 못했어요. 1분 뒤에 다시 보내 주세요.' },
        gone: { title: '떠났어요', text: '{name}은(는) 이제 없어요. 봇이 삭제되어 이 채팅은 닫혔어요.' },
        no_access: { title: '채팅할 수 없어요', text: '봇의 방에 갈 수 있게 되면 {name}와(과) 채팅할 수 있어요.' },
    },
    nl: {
        resting: { title: 'Rust', lead: '{name} rust even.', text: 'De eigenaar van de bot heeft hem voorlopig uitgezet, dus hij kan pas antwoorden als hij weer aan staat.' },
        unready: { title: 'Nog niet klaar', lead: '{name} is nog niet klaar om te chatten.', text: 'De eigenaar van de bot moet hem nog verder instellen. Probeer het een andere dag opnieuw.' },
        trouble: { title: 'Geen antwoord', text: '{name} kon daar nu niet op antwoorden. Stuur het over een minuut opnieuw.' },
        gone: { title: 'Weg', text: '{name} is er niet meer. De bot is verwijderd, dus deze chat is gesloten.' },
        no_access: { title: 'Chatten kan niet', text: 'Je kunt met {name} chatten zodra je de ruimte van de bot kunt bezoeken.' },
    },
    pt: {
        resting: { title: 'Descansando', lead: '{name} está descansando.', text: 'O dono do bot desligou ele por enquanto, então ele não pode responder até voltar.' },
        unready: { title: 'Ainda não está pronto', lead: '{name} ainda não está pronto para conversar.', text: 'O dono do bot ainda precisa terminar de configurá-lo. Tente outro dia.' },
        trouble: { title: 'Não conseguiu responder', text: '{name} não conseguiu responder agora. Envie de novo daqui a um minuto.' },
        gone: { title: 'Saiu', text: '{name} não está mais por aqui. O bot foi removido, então esta conversa está encerrada.' },
        no_access: { title: 'Não dá para conversar', text: 'Você poderá conversar com {name} quando puder visitar a sala do bot.' },
    },
    zh: {
        resting: { title: '休息中', lead: '{name}正在休息。', text: '机器人的主人暂时关闭了它，所以在重新开启之前它无法回复。' },
        unready: { title: '尚未准备好', lead: '{name}还没准备好聊天。', text: '机器人的主人还需要完成设置。请改天再试。' },
        trouble: { title: '暂时无法回答', text: '{name}刚才没能回答。请一分钟后再发一次。' },
        gone: { title: '已离开', text: '{name}已经不在了。这个机器人已被删除，所以此聊天已关闭。' },
        no_access: { title: '无法聊天', text: '当你可以访问机器人的房间时，就能和{name}聊天了。' },
    },
};

/** Frequent short words per Latin-script language. A message needs at least one to count. */
const COMMON_WORDS: Record<'en' | 'ca' | 'de' | 'es' | 'fr' | 'it' | 'nl' | 'pt', string[]> = {
    en: ['the', 'and', 'you', 'are', 'is', 'what', 'where', 'how', 'hello', 'hi', 'hey', 'please', 'thanks', 'can', 'do', 'my', 'me', 'i', 'it', 'this', 'there', 'around', 'yes', 'no'],
    ca: ['hola', 'bon', 'dia', 'gràcies', 'amb', 'per', 'i', 'el', 'els', 'què', 'ets', 'estàs', 'molt', 'si', 'jo', 'tu', 'aquí', 'ara', 'com', 'on', 'puc'],
    de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ich', 'du', 'bist', 'wie', 'wo', 'was', 'hallo', 'danke', 'bitte', 'ja', 'nein', 'mit', 'ein', 'eine', 'kannst', 'guten', 'tag', 'moin', 'servus'],
    es: ['el', 'la', 'los', 'las', 'que', 'qué', 'y', 'es', 'estás', 'eres', 'hola', 'gracias', 'por', 'favor', 'cómo', 'dónde', 'sí', 'yo', 'tú', 'con', 'una', 'muy', 'buenas', 'puedes'],
    fr: ['le', 'la', 'les', 'et', 'est', 'je', 'tu', 'vous', 'bonjour', 'salut', 'merci', 'oui', 'non', 'pas', 'que', 'quoi', 'où', 'comment', 'avec', 'une', 'des', 'suis', 'es', 'êtes', 'ça'],
    it: ['il', 'lo', 'la', 'gli', 'che', 'e', 'è', 'sei', 'ciao', 'grazie', 'per', 'favore', 'come', 'dove', 'sì', 'io', 'tu', 'con', 'una', 'non', 'buongiorno', 'puoi', 'cosa'],
    nl: ['de', 'het', 'een', 'en', 'is', 'ik', 'jij', 'je', 'niet', 'wat', 'waar', 'hoe', 'hoi', 'hallo', 'dank', 'bedankt', 'alsjeblieft', 'ja', 'nee', 'met', 'ben', 'kun', 'goedemorgen'],
    pt: ['o', 'os', 'as', 'que', 'e', 'é', 'você', 'está', 'olá', 'oi', 'obrigado', 'obrigada', 'por', 'favor', 'como', 'onde', 'sim', 'não', 'eu', 'com', 'uma', 'muito', 'tudo', 'bem', 'pode'],
};

/** Letters only some of these languages use, as a tie-breaker for short messages. */
const TELLTALE_LETTERS: Array<[RegExp, keyof typeof COMMON_WORDS]> = [
    [/ß/, 'de'],
    [/[ñ¿¡]/, 'es'],
    [/[ãõ]/, 'pt'],
    [/ŀl|l·l/, 'ca'],
    [/[ĳ]/, 'nl'],
];

/** Guess the language of a message from its script and common words. English when unsure. */
export function detectLanguage(text: string): NoteLanguage {
    const sample = (text || '').slice(0, 500);
    if (/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(sample)) return 'ar';
    if (/[぀-ヿ]/.test(sample)) return 'ja';
    if (/[가-힯ᄀ-ᇿ]/.test(sample)) return 'ko';
    if (/[一-鿿]/.test(sample)) return 'zh';

    const words = sample.toLowerCase().match(/[\p{L}·']+/gu) ?? [];
    const scores = new Map<keyof typeof COMMON_WORDS, number>();
    for (const [language, list] of Object.entries(COMMON_WORDS) as Array<[keyof typeof COMMON_WORDS, string[]]>) {
        const set = new Set(list);
        scores.set(language, words.filter((word) => set.has(word)).length);
    }
    for (const [pattern, language] of TELLTALE_LETTERS) {
        if (pattern.test(sample)) scores.set(language, (scores.get(language) ?? 0) + 2);
    }
    let best: keyof typeof COMMON_WORDS = 'en';
    let bestScore = scores.get('en') ?? 0;
    let tie = false;
    for (const [language, score] of scores) {
        if (language === 'en') continue;
        if (score > bestScore) {
            best = language;
            bestScore = score;
            tie = false;
        } else if (score === bestScore && score > 0) {
            tie = true;
        }
    }
    return tie || bestScore === 0 ? 'en' : best;
}

/** The Matrix content of a note: a notice everyone can read, plus the parts the game draws as a card. */
export function statusNoteContent(state: BotNoteState, language: NoteLanguage, botName: string): Record<string, unknown> {
    const words = NOTES[language][state];
    const fill = (value: string) => value.split('{name}').join(botName);
    const text = fill(words.text);
    const body = words.lead ? `${fill(words.lead)} ${text}` : text;
    return {
        msgtype: 'm.notice',
        body,
        [BOT_STATUS_KEY]: { state, title: words.title, text, lang: language },
    };
}
