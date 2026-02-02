// Hindi (Devanagari) Language Data

export const hindi = {
    id: 'hindi',
    name: 'Hindi',
    native: 'हिन्दी',
    fontClass: 'devanagari',
    fontFamily: 'Noto Sans Devanagari',
    
    consonants: [
        { char: 'क', roman: 'ka' },
        { char: 'ख', roman: 'kha' },
        { char: 'ग', roman: 'ga' },
        { char: 'घ', roman: 'gha' },
        { char: 'ङ', roman: 'ṅa' },
        { char: 'च', roman: 'ca' },
        { char: 'छ', roman: 'cha' },
        { char: 'ज', roman: 'ja' },
        { char: 'झ', roman: 'jha' },
        { char: 'ञ', roman: 'ña' },
        { char: 'ट', roman: 'ṭa' },
        { char: 'ठ', roman: 'ṭha' },
        { char: 'ड', roman: 'ḍa' },
        { char: 'ढ', roman: 'ḍha' },
        { char: 'ण', roman: 'ṇa' },
        { char: 'त', roman: 'ta' },
        { char: 'थ', roman: 'tha' },
        { char: 'द', roman: 'da' },
        { char: 'ध', roman: 'dha' },
        { char: 'न', roman: 'na' },
        { char: 'प', roman: 'pa' },
        { char: 'फ', roman: 'pha' },
        { char: 'ब', roman: 'ba' },
        { char: 'भ', roman: 'bha' },
        { char: 'म', roman: 'ma' },
        { char: 'य', roman: 'ya' },
        { char: 'र', roman: 'ra' },
        { char: 'ल', roman: 'la' },
        { char: 'व', roman: 'va' },
        { char: 'श', roman: 'śa' },
        { char: 'ष', roman: 'ṣa' },
        { char: 'स', roman: 'sa' },
        { char: 'ह', roman: 'ha' }
    ],

    vowels: [
        { char: 'अ', roman: 'a' },
        { char: 'आ', roman: 'ā', matra: 'ा' },
        { char: 'इ', roman: 'i', matra: 'ि' },
        { char: 'ई', roman: 'ī', matra: 'ी' },
        { char: 'उ', roman: 'u', matra: 'ु' },
        { char: 'ऊ', roman: 'ū', matra: 'ू' },
        { char: 'ए', roman: 'e', matra: 'े' },
        { char: 'ऐ', roman: 'ai', matra: 'ै' },
        { char: 'ओ', roman: 'o', matra: 'ो' },
        { char: 'औ', roman: 'au', matra: 'ौ' },
        { char: 'ऋ', roman: 'ṛ', matra: 'ृ' }
    ],

    getDisplayLabel(charData) {
        return charData.roman;
    },

    hasDevanagari: false // Hindi IS Devanagari, so no separate display needed
};
