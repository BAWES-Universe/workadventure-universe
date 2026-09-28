import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const quest: DeepPartial<Translation["quest"]> = {
    quests: "Missioni",

    welcome: "Benvenuto",
    close: "Chiudi",
    minutes: "{minutes} min",
    acceptedCount: "{count} mission{{e|i}} accettat{{a|e}}",
    newActivity: "Novità nelle missioni",
    invitation: {
        line: "Benvenuto! Ti va di dare un'occhiata?",
        secondary: "Un paio di minuti, con calma.",
        showOptions: "Iniziamo!",
        notNow: "Non ora",
    },
    options: {
        title: "Cosa ti piacerebbe fare?",
        tryAnother: "Vuoi provarne un'altra?",
    },
    paths: {
        meet: {
            title: "Conosci qualcuno",
            description: "Saluta chi c'è.",
            objective: "Saluta qualcuno",
            body: "Avvicinati a qualcuno. Quando si apre la bolla, saluta.",
            waiting: "Saluto inviato. In attesa di risposta.",
            payoff: "Piacere di conoscerti.",
            payoffNeutral: "Hai salutato. Benvenuto.",
            lastTime: "L'ultima volta hai salutato.",
        },
        explore: {
            title: "Esplora questo posto",
            description: "Trova: {area}.",
            objective: "Trova: {area}",
            body: "Cammina fino a {area} ed entra.",
            walk: "Vai a {area}",
            notOnThisMap: "{area} è in un'altra stanza.",
            payoff: "Hai trovato {area}.",
            lastTime: "L'ultima volta hai trovato {area}.",
        },
        build: {
            title: "Prova a costruire",
            description: "Aggiungi una cosa alla mappa.",
            objective: "Aggiungi una cosa",
            body: "Apri l'editor della mappa e posiziona una cosa.",
            noPosition: "Apri Tools, poi l'editor della mappa.",
            payoff: "Ora è tuo. Resta lì.",
            lastTime: "L'ultima volta hai aggiunto qualcosa.",
            needs: "Serve: permesso di modifica in questa stanza",
        },
    },
    stamps: {
        meet: "Primo saluto",
        explore: "Esploratore",
        build: "Costruttore",
        badge: "Distintivo {stamp}",
    },
    pill: {
        open: "Apri le missioni",
        close: "Chiudi le missioni",
        inProgress: "in corso",
        done: "fatto",
        toDo: "{count} da fare",
    },
    card: {
        openEditor: "Apri l'editor della mappa",
        walkThere: "Vai lì",
        stopWalking: "Fermati",
        chooseAnother: "Scegline un'altra",
        nobodyHere: "Al momento non c'è nessuno",
        direction: "{target} è a {direction}, a circa {steps} pass{{o|i}}",
    },
    directions: {
        north: "nord",
        northEast: "nord-est",
        east: "est",
        southEast: "sud-est",
        south: "sud",
        southWest: "sud-ovest",
        west: "ovest",
        northWest: "nord-ovest",
    },
    log: {
        inProgress: "In corso",
        onMap: "Sulla mappa",
        tapToStart: "Tocca per iniziare",
        progress: "{done} su {total} fatte",
        allDone: "Qui hai fatto tutto. Torna quando ci sarà altro.",
        available: "Disponibili",
        done: "Fatte",

        fromHost: "{host} · {room}",
        here: "{room}",
        signInRow: "Accedi per mantenere i progressi su tutti i dispositivi",
        needsAccount: "Serve: un account",
        nothingHere: "Qui non c'è ancora niente da fare",
    },
    celebration: {
        questComplete: "Missione completata",
        badgeEarned: "Distintivo {stamp} ottenuto",
        chapterTitle: "Capitolo di benvenuto completato",
        chapterLine: "Hai salutato, hai esplorato e hai lasciato il segno.",
        continue: "Continua",
    },
    announce: {
        tracking: "Sulla mappa: {objective}",
        done: "Fatto: {objective}",
        finishedMany: "Hai completato {count} cose.",
    },
};

export default quest;
