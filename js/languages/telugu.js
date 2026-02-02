// Telugu Language Data

export const telugu = {
    id: 'telugu',
    name: 'Telugu',
    native: 'తెలుగు',
    fontClass: 'telugu',
    fontFamily: 'Noto Sans Telugu',
    
    consonants: [
        { char: 'క', roman: 'ka', devanagari: 'क' },
        { char: 'ఖ', roman: 'kha', devanagari: 'ख' },
        { char: 'గ', roman: 'ga', devanagari: 'ग' },
        { char: 'ఘ', roman: 'gha', devanagari: 'घ' },
        { char: 'ఙ', roman: 'ṅa', devanagari: 'ङ' },
        { char: 'చ', roman: 'ca', devanagari: 'च' },
        { char: 'ఛ', roman: 'cha', devanagari: 'छ' },
        { char: 'జ', roman: 'ja', devanagari: 'ज' },
        { char: 'ఝ', roman: 'jha', devanagari: 'झ' },
        { char: 'ఞ', roman: 'ña', devanagari: 'ञ' },
        { char: 'ట', roman: 'ṭa', devanagari: 'ट' },
        { char: 'ఠ', roman: 'ṭha', devanagari: 'ठ' },
        { char: 'డ', roman: 'ḍa', devanagari: 'ड' },
        { char: 'ఢ', roman: 'ḍha', devanagari: 'ढ' },
        { char: 'ణ', roman: 'ṇa', devanagari: 'ण' },
        { char: 'త', roman: 'ta', devanagari: 'त' },
        { char: 'థ', roman: 'tha', devanagari: 'थ' },
        { char: 'ద', roman: 'da', devanagari: 'द' },
        { char: 'ధ', roman: 'dha', devanagari: 'ध' },
        { char: 'న', roman: 'na', devanagari: 'न' },
        { char: 'ప', roman: 'pa', devanagari: 'प' },
        { char: 'ఫ', roman: 'pha', devanagari: 'फ' },
        { char: 'బ', roman: 'ba', devanagari: 'ब' },
        { char: 'భ', roman: 'bha', devanagari: 'भ' },
        { char: 'మ', roman: 'ma', devanagari: 'म' },
        { char: 'య', roman: 'ya', devanagari: 'य' },
        { char: 'ర', roman: 'ra', devanagari: 'र' },
        { char: 'ల', roman: 'la', devanagari: 'ल' },
        { char: 'వ', roman: 'va', devanagari: 'व' },
        { char: 'శ', roman: 'śa', devanagari: 'श' },
        { char: 'ష', roman: 'ṣa', devanagari: 'ष' },
        { char: 'స', roman: 'sa', devanagari: 'स' },
        { char: 'హ', roman: 'ha', devanagari: 'ह' },
        { char: 'ళ', roman: 'ḷa', devanagari: 'ळ' },
        { char: 'క్ష', roman: 'kṣa', devanagari: 'क्ष' }
    ],

    vowels: [
        { char: 'ా', roman: 'ā', devanagari: 'ा' },
        { char: 'ి', roman: 'i', devanagari: 'ि' },
        { char: 'ీ', roman: 'ī', devanagari: 'ी' },
        { char: 'ు', roman: 'u', devanagari: 'ु' },
        { char: 'ూ', roman: 'ū', devanagari: 'ू' },
        { char: 'ె', roman: 'e', devanagari: 'े' },
        { char: 'ే', roman: 'ē', devanagari: 'े' },
        { char: 'ై', roman: 'ai', devanagari: 'ै' },
        { char: 'ొ', roman: 'o', devanagari: 'ो' },
        { char: 'ో', roman: 'ō', devanagari: 'ो' },
        { char: 'ౌ', roman: 'au', devanagari: 'ौ' }
    ],

    getDisplayLabel(charData) {
        return charData.devanagari || charData.roman;
    },

    hasDevanagari: true
};
