import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const warning: DeepPartial<Translation["warning"]> = {
    title: "Atenció!",
    content: `Aquest món està apropant-se al seu límit! Podeu actualitzar la seva capacitat <a href="{upgradeLink}" target="_blank">aquí</a>`,
    limit: "Aquest món està apropant-se al seu límit!",
    accessDenied: {
        camera: "Accés a la càmera denegat. Feu clic aquí i reviseu els permissos del vostre navegador.",
        screenSharing: "Compartir pantalla denegat. Feu clic aquí i reviseu els permissos del vostre navegador.",
        room: "Accés a l'habitació denegat. No t'és permès entrar a aquesta habitació.",
        teleport: "Não está autorizado a teletransportar-se para este utilizador.",
    },
    importantMessage: "Missatge important",
    connectionLost: "Conexió perduda. Reconectant...",
    connectionLostTitle: "Conexió perduda",
    connectionLostSubtitle: "Reconectant",
    reconnectingTitle: "Reconectant",
    waitingConnectionTitle: "Esperant a la conexió",
    waitingConnectionSubtitle: "Conectant",
    popupBlocked: {
        title: "Bloqueig de finestres emergents",
        content:
            "Si us plau, permeteu finestres emergents per a aquest lloc web en la configuració del vostre navegador.",
        done: "Ok",
    },
    browserNotSupported: {
        title: "😢 Navegador no compatible",
        message: "El vostre navegador ({browserName}) ja no és compatible amb Universe.",
        description:
            "El vostre navegador és massa antic per executar Universe. Si us plau, actualitzeu-lo a la darrera versió per continuar.",
        whatToDo: "Què podeu fer?",
        option1: "Actualitzar {browserName} a la darrera versió",
        option2: "Sortir de Universe i utilitzar un navegador diferent",
        updateBrowser: "Actualitzar navegador",
        leave: "Sortir",
    },
};

export default warning;
