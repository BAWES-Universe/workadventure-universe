import type { BaseTranslation } from "../i18n-types";

const login: BaseTranslation = {
    input: {
        name: {
            placeholder: "Enter your name",
            empty: "The name is empty",
            tooLongError: "Name is too long",
            notValidError: "Incorrect name format",
        },
    },
    genericError: "An error occurred",
    terms: "By continuing, you are agreeing our {links}.",
    termsOfUse: "terms of use",
    privacyPolicy: "privacy policy",
    cookiePolicy: "cookie policy",
    continue: "Continue",
    eyebrow: "Edit your name",
    heading: "What should people call you?",
    hint: "Everyone in the room sees this above your WOKA.",
    close: "Back to your room",
};

export default login;
