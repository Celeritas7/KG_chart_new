// Language Index - Exports all language modules

import { burmese } from './burmese.js';

// Export all languages as a single object
export const languages = {
    burmese
};

// Export individual languages for direct import
export { burmese };

// Helper function to get language by ID
export function getLanguage(id) {
    return languages[id] || null;
}

// Get list of all language IDs
export function getLanguageIds() {
    return Object.keys(languages);
}

// Get list of languages with Devanagari support (for quiz mode)
export function getDevanagariLanguages() {
    return Object.values(languages).filter(lang => lang.hasDevanagari);
}
