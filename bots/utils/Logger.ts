/**
 * Simple logger utility that respects environment variables
 * Disables verbose logging in production to avoid memory/performance issues
 */

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.ENABLE_BOT_DEBUG === 'true';
const isVerbose = process.env.ENABLE_BOT_VERBOSE === 'true';

export const logger = {
    /**
     * Always log errors
     */
    error: (...args: any[]): void => {
        console.error(...args);
    },

    /**
     * Always log warnings
     */
    warn: (...args: any[]): void => {
        console.warn(...args);
    },

    /**
     * Log info messages only in development
     */
    info: (...args: any[]): void => {
        if (isDevelopment) {
            console.log(...args);
        }
    },

    /**
     * Log debug messages only in development with verbose flag
     */
    debug: (...args: any[]): void => {
        if (isDevelopment && isVerbose) {
            console.log(...args);
        }
    },

    /**
     * Log movement-related messages (throttled in production)
     */
    movement: (...args: any[]): void => {
        if (isDevelopment) {
            console.log(...args);
        }
    },
};

