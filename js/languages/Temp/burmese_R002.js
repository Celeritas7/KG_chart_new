// Burmese (Myanmar) Language Data
export const burmese = {
    id: 'burmese',
    name: 'Burmese',
    native: 'မြန်မာ',
    fontClass: 'burmese',
    fontFamily: 'Noto Sans Myanmar',

    // Basic Consonants (K, S, T, P Groups)
    consonants: [
        { char: 'က', roman: 'ka', devanagari: 'क' },
        { char: 'ခ', roman: 'kha', devanagari: 'ख' },
        { char: 'ဂ', roman: 'ga', devanagari: 'ग' },
        { char: 'ဃ', roman: 'gha', devanagari: 'घ' },
        { char: 'င', roman: 'nga', devanagari: 'ङ' },
        { char: 'ငြ', roman: 'ngra', devanagari: 'ङ' },
        { char: 'ကျ', roman: 'kya', devanagari: 'च' },
        { char: 'ကြ', roman: 'kra', devanagari: 'च' },
        { char: 'ချ', roman: 'khya', devanagari: 'छ' },
        { char: 'ခြ', roman: 'khra', devanagari: 'छ' },
        { char: 'ဇ', roman: 'ja', devanagari: 'ज' },
        { char: 'ဂျ', roman: 'gya', devanagari: 'ज' },
        { char: 'ဈ', roman: 'jha', devanagari: 'झ' },
        { char: 'ဂြ', roman: 'gra', devanagari: 'झ' },
        { char: 'ဉ ', roman: 'nya', devanagari: 'ञ' },
        { char: 'ည', roman: 'nyya', devanagari: 'ञ' },
        { char: 'ဋ', roman: 'ṭa', devanagari: 'ट' },
        { char: 'ဌ', roman: 'ṭha', devanagari: 'ठ' },
        { char: 'ဍ', roman: 'ḍa', devanagari: 'ड' },
        { char: 'ဎ', roman: 'ḍha', devanagari: 'ढ' },
        { char: 'ဏ', roman: 'ṇa', devanagari: 'ण' },
        { char: 'တ', roman: 'ta', devanagari: 'त' },
        { char: 'ထ', roman: 'tha', devanagari: 'थ' },
        { char: 'သ', roman: 'sa', devanagari: 'थ' }, // Mapping based on your provided update
        { char: 'ဒ', roman: 'da', devanagari: 'द' },
        { char: 'ဓ', roman: 'dha', devanagari: 'ध' },
        { char: 'န', roman: 'na', devanagari: 'न' },
        { char: 'ပ', roman: 'pa', devanagari: 'प' },
        { char: 'ဖ', roman: 'pha', devanagari: 'फ' },
        { char: 'ဗ', roman: 'ba', devanagari: 'ब' },
        { char: 'ဘ', roman: 'bha', devanagari: 'भ' },
        { char: 'မ', roman: 'ma', devanagari: 'म' },
        { char: 'ယ', roman: 'ya', devanagari: 'य' },
        { char: 'ရ', roman: 'ra', devanagari: 'र' },
        { char: 'လ', roman: 'la', devanagari: 'ल' },
        { char: 'ဝ', roman: 'wa', devanagari: 'व' },
        { char: 'ရှ', roman: 'sha', devanagari: 'श' },
        { char: 'စ', roman: 'ca', devanagari: 'स' }, // S-Group adjustment based on your list
        { char: 'ဆ', roman: 'cha', devanagari: 'स' },
        { char: 'ဿ', roman: 'ssa', devanagari: 'स्स' },
        { char: 'ဟ', roman: 'ha', devanagari: 'ह' },
        { char: 'ဠ', roman: 'ḷa', devanagari: 'ळ' },
        { char: 'အ', roman: 'a', devanagari: 'अ' }
    ],

    medials: [
        { char: 'ျ', roman: 'ya', devanagari: '्य' },
        { char: 'ြ', roman: 'ra', devanagari: '्य' },
        { char: 'ွ', roman: 'wa', devanagari: '्व' },
        { char: 'ှ', roman: 'ha', devanagari: '्ह' }
    ],

    finals: [
        { char: 'က်', roman: 'k', devanagari: 'क्' },
        { char: 'င်', roman: 'ng', devanagari: 'ं' },
        { char: 'င်္', roman: 'ng', devanagari: 'ं' },
        { char: 'စ်', roman: 'c', devanagari: 'च्' },
        { char: 'ည်', roman: 'ny', devanagari: 'ञ्' },
        { char: 'တ်', roman: 't', devanagari: 'त्' },
        { char: 'န်', roman: 'n', devanagari: 'न्' },
        { char: 'ပ်', roman: 'p', devanagari: 'प्' },
        { char: 'မ်', roman: 'm', devanagari: 'म्' },
        { char: 'ယ်', roman: 'y', devanagari: 'य्' },
        { char: 'သ်', roman: 's', devanagari: 'स्' }
    ],

    markers: [
        { char: '်', roman: '', devanagari: '्' },
        { char: '့', roman: '.', devanagari: '॰' },
        { char: 'း', roman: ':', devanagari: 'ः' },
        { char: '္', roman: '', devanagari: '्' }
    ],

    // Vowels for future use
    vowels: [
        { char: 'ာ', roman: 'ā', devanagari: 'ा' },
        { char: 'ိ', roman: 'i', devanagari: 'ि' },
        { char: 'ီ', roman: 'ī', devanagari: 'ी' },
        { char: 'ု', roman: 'u', devanagari: 'ु' },
        { char: 'ူ', roman: 'ū', devanagari: 'ू' },
        { char: 'ေ', roman: 'e', devanagari: 'े' },
        { char: 'ဲ', roman: 'ai', devanagari: 'ै' },
        { char: 'ော', roman: 'o', devanagari: 'ो' },
        { char: 'ော်', roman: 'au', devanagari: 'ौ' },
        { char: 'ါ', roman: 'a', devanagari: 'ा' },
        { char: 'ာ', roman: 'a', devanagari: 'ा' },
        { char: 'ိ', roman: 'i', devanagari: 'ि' },
        { char: 'ီ', roman: 'i', devanagari: 'ी' },
        { char: 'ု', roman: 'u', devanagari: 'ु' },
        { char: 'ူ', roman: 'u', devanagari: 'ू' },
        { char: 'ေ', roman: 'e', devanagari: 'े' },
        { char: 'ဲ', roman: 'ai', devanagari: 'ै' },
        { char: 'ော', roman: 'o', devanagari: 'ो' },
        { char: 'ို', roman: 'o', devanagari: 'ो' },
        { char: 'ွန်', roman: 'un', devanagari: 'ुन', name: 'un' },
        { char: 'ုန်', roman: 'on', devanagari: 'ोन', name: 'on' }
    ],

    // Language-specific helper methods
    getDisplayLabel(charData) {
        return charData.devanagari || charData.roman;
    },

    hasDevanagari: true
};
