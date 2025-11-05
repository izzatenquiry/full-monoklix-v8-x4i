import eventBus from './eventBus';
import { triggerErrorWebhook } from './webhookService';

/**
 * Handles API errors by identifying the error type, triggering auto-repair mechanisms,
 * and returning a user-friendly error string to be displayed by the UI components.
 * @param {unknown} error - The error caught from the API call.
 * @returns {string} A user-friendly error message.
 */
export const handleApiError = (error: unknown): string => {
    console.error("Original API Error:", error);
    
    // Automatically trigger the webhook for admin notification
    triggerErrorWebhook(error);

    let message: string;
    if (error instanceof Error) {
        message = error.message;
    } else {
        message = String(error);
    }
    
    const lowerCaseMessage = message.toLowerCase();
    let errorCode: string | undefined;

    // --- Start Error Code Detection ---
    
    // 1. Prioritize specific keywords that map directly to our desired user messages.
    if (lowerCaseMessage.includes('resource exhausted') || lowerCaseMessage.includes('quota exceeded')) {
        errorCode = '429';
    } else if (lowerCaseMessage.includes('bad request') && (lowerCaseMessage.includes('safety') || lowerCaseMessage.includes('filter'))) {
        errorCode = '400_SAFETY'; // Specifically a safety filter error
    }

    // 2. If a specific code wasn't found via keywords, proceed with generic parsing.
    if (!errorCode) {
        try {
            const jsonMatch = message.match(/(\{.*\})/s);
            if (jsonMatch && jsonMatch[0]) {
                const errorObj = JSON.parse(jsonMatch[0]);
                if (errorObj?.error?.code) {
                    errorCode = String(errorObj.error.code);
                }
            }
        } catch (e) { /* ignore json parsing errors */ }

        if (!errorCode) {
            const codeMatch = message.match(/\[(\d{3})\]|\b(\d{3})\b/);
            if (codeMatch) {
                errorCode = codeMatch[1] || codeMatch[2];
            }
        }

        if (!errorCode) {
            if (lowerCaseMessage.includes('permission denied') || lowerCaseMessage.includes('api key not valid')) {
                errorCode = '403';
            } else if (lowerCaseMessage.includes('bad request')) {
                errorCode = '400';
            } else if (lowerCaseMessage.includes('server error') || lowerCaseMessage.includes('503')) {
                errorCode = '500';
            } else if (lowerCaseMessage.includes('failed to fetch')) {
                errorCode = 'NET';
            }
        }
    }
    // --- End Error Code Detection ---

    // A more specific check for definitive API key failures to avoid false positives.
    const isDefinitiveApiKeyFailure = 
        lowerCaseMessage.includes('api key not valid. please pass a valid api key') ||
        lowerCaseMessage.includes('permission denied. failed to verify the api key') ||
        lowerCaseMessage.includes('api key not found');
    
    if (isDefinitiveApiKeyFailure) {
        eventBus.dispatch('personalTokenFailed');
        return "Your connection token is invalid or has failed. Please claim a new token from the Key icon in the header.";
    }
    
    switch(errorCode) {
        case '400_SAFETY': return 'Request blocked by safety filters. Please try a different prompt or image.';
        case '400': return 'Invalid request. This can be caused by an unsupported image format (please use PNG or JPG) or an issue with the prompt.';
        case '403': // Generic permission error, but not a definitive key failure
        case '401':
             return "Permission denied. Your token may lack permissions for this specific model. Please try claiming a new token.";
        case '429': return 'Server Penuh. Sila tunggu sebentar sebelum mencuba lagi.';
        case '500':
        case '503': return 'Google API is temporarily unavailable. Please try again in a few moments.';
        case 'NET': return 'Network error. Please check your internet connection.';
        default: {
            const firstLine = message.split('\n')[0];

            if (firstLine.length > 150 || firstLine.includes('[GoogleGenerativeAI Error]')) {
                return 'An unexpected error occurred. Please try again. If the problem persists, check the AI API Log for details.';
            }
            
            return firstLine;
        }
    }
};
