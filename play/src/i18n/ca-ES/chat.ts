import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const chat: DeepPartial<Translation["chat"]> = {
    intro: "Aquí està el vostre històric del chat:",
    enter: "Escribiu el vostre missatge...",
    menu: {
        visitCard: "Targeta de visita",
        addFriend: "Afegir amic",
    },
    typing: "esta escribiendo...",
    userList: {
        editMyVisitCard: "Edita la meva targeta de visita",
        viewProfile: "Veure el perfil",
        follow: "Localitzar",
    },
    botStatus: {
        online: "En línia",
        resting: "Descansant",
        unready: "Encara no està a punt",
        gone: "Se n'ha anat",
        restingPlaceholder: "Les respostes estan en pausa",
        unreadyPlaceholder: "Encara no pot respondre",
        closed: "Aquest xat està tancat",
        left: "{name} se n'ha anat",
        visit: "Visita",
        visitAria: "Visita {name} a {room}",
        livesIn: "Viu a",
        nowIn: "Ara a",
        inThisRoom: "Ets en aquesta sala",
    },
    brick: {
        computer: {
            screenInControl: "Tens el control · {name} espera",
            lastStepLine: "Paga i envia, després torna el control. {name} espera fins que acabis.",
            trustTitle: "{name} té ús complet de l'ordinador",
            trustLine:
                "{name} hi pot instal·lar i executar qualsevol cosa i accedir a tot el que hi ha. Un inici de sessió fet en aquest ordinador es pot fer servir en qualsevol tasca de {name}.",
            screenControlLine: "Estàs escrivint a l'ordinador de {name}. {name} pot accedir a tot el que hi ha.",
            gettingItReady: "Preparant…",
            runningTitle: "Alguna cosa encara s'està executant",
            runningLine:
                "Un programa que ha instal·lat {name} encara s'executa en aquest ordinador. Podria veure el que escrius. Reiniciar-lo el tanca.",
            restartFirst: "Reinicia primer",
            takeOverAnyway: "Pren el control igualment",
            restartingHead: "Reiniciant · {name} t'ho tornarà a demanar",
            restartingLine:
                "Reiniciant l'ordinador de {name}. Tot es tanca i després {name} torna a preparar la pàgina i t'ho demana.",
            restartingBar: "{job} · reiniciant l'ordinador",
            runningAgainTitle: "Encara s'executa",
            runningAgainLine:
                "Ha tornat a arrencar després del reinici, així que encara podria veure el que escrius. Continua només si et sembla bé per a aquest pas.",
            notNow: "Ara no",
            screenInControlRunning: "Tens el control · un programa encara s'executa",
            screenControlRunningLine:
                "Estàs escrivint a l'ordinador de {name}. Un programa que ha instal·lat {name} encara s'executa i podria veure el que escrius.",
            notReady: "No s'ha pogut preparar l'ordinador. No s'ha canviat res. Torna-ho a provar.",
        },
    },
    artifacts: {
        openPublic: "Públic",
        openPublicHelp: "Qualsevol persona amb l'enllaç només veu el que publiques",
        notPublished: "Encara no publicat",
        publishHelp:
            "La gent veu la versió que publiques. Els canvis posteriors es mantenen privats fins que tornis a publicar.",
        publishVersion: "Publica la versió {version}",
        publishedStatus: "Publicat · Versió {version} · {time}",
        unpublishedChanges: "La versió {version} encara no està publicada",
        linkFollows: "L'enllaç sempre mostra la teva última versió.",
        publishBar: "Publicat: versió {version}. La versió {latest} encara no està publicada.",
        publish: "Publica",
        publishing: "S'està publicant…",
        publishFailed: "No s'ha pogut publicar. Torna-ho a provar.",
        publicUnavailable: "Versió pública no disponible",
        publicUnavailableHelp: "La gent veu «No disponible» fins que publiquis una versió.",
    },
};

export default chat;
