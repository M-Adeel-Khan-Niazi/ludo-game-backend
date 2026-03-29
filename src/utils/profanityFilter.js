// src/utils/profanityFilter.js

const BAD_WORDS = [
    "ass", "asshole", "bastard", "bitch", "cunt", "damn", "fuck", "motherfucker",
    "shit", "whore", "slut", "dick", "pussy", "cock", "faggot", "nigger", "nigga",
    "retard", "idiot"
];

/**
 * Replaces profanity with ***
 * @param {string} text 
 * @returns {string} cleaned text
 */
function cleanMessage(text) {
    if (!text || typeof text !== 'string') return text;

    let cleaned = text;
    for (const badWord of BAD_WORDS) {
        const regex = new RegExp(`\\b${badWord}\\b`, "gi");
        cleaned = cleaned.replace(regex, "***");
    }
    return cleaned;
}

module.exports = {
    cleanMessage,
    BAD_WORDS
};
