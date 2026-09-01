import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const actionbar: DeepPartial<Translation["actionbar"]> = {
    botEditor: "Editor de bots",
    botEditorModule: {
        visionMarker: "👁 visión",
        providerDisabled: "(Deshabilitado)",
        visionHelper:
            "Los proveedores que pueden ver imágenes están marcados con 👁 — las imágenes enviadas por los jugadores se procesan automáticamente, sin configuración adicional.",
        aiProviderLabel: "Proveedor de IA",
        aiProviderHelp: "(Selecciona el proveedor de IA para este bot)",
        loadingProviders: "Cargando proveedores...",
        retry: "Reintentar",
        noProvidersConfigured:
            "No hay proveedores de IA configurados. Configura los proveedores en la API de administración primero.",
        errorNotInitialized: "Servicio de API del bot no inicializado",
        errorNoProviders:
            "No hay proveedores de IA disponibles. Configura los proveedores en la API de administración.",
        errorLoadFailed: "No se pudieron cargar los proveedores de IA",
        providerVisionHeading: "Proveedor de IA y visión",
        chatInstructions: "Instrucciones de chat",
        chatInstructionsHelp: "(Qué debe decir el bot y cómo debe comunicarse)",
        chatInstructionsPlaceholder:
            "Ejemplo: eres un bot de bienvenida amigable llamado 'WelcomeBot'. Tu trabajo es dar la bienvenida a los nuevos visitantes del vestíbulo. Sé alegre y servicial. Responde preguntas sobre el espacio. No repitas el mismo saludo a alguien a quien ya saludaste hoy.",
        noChatInstructions: "No se han establecido instrucciones de chat",
    },
    help: {
        audioManager: {
            title: "Volumen de sonidos ambientales",
            desc: "Configure el volumen de audio haciendo clic aquí.",
            pause: "Haga clic aquí para pausar el audio",
            play: "Haga clic aquí para reproducir el audio",
            stop: "Haga clic aquí para detener el audio",
        },
        audioManagerNotAllowed: {
            title: "Sonidos ambientales bloqueados",
            desc: "Su navegador ha impedido la reproducción de sonidos ambientales. Haga clic en el icono para iniciar la reproducción.",
        },
    },
    personalDesk: {
        label: "Ir a mi escritorio",
        unclaim: "Liberar mi escritorio",
        errorNoUser: "No se pueden encontrar sus datos de usuario",
        errorNotFound: "Aún no tiene un escritorio personal",
        errorMoving: "No se puede llegar a su escritorio personal",
        errorUnclaiming: "No se puede liberar su escritorio personal",
    },
};

export default actionbar;
