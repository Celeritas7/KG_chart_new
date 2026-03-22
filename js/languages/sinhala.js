// Sinhala (Sri Lankan) Language Data
const sinhala = {
    id: 'sinhala',
    name: 'Sinhala',
    native: 'සිංහල',
    fontClass: 'sinhala',
    fontFamily: 'Noto Sans Sinhala',

    // Basic Consonants (mapped from Excel: Sinhala → Devanagari → Roman)
    consonants: [
        { char: 'ක', roman: 'ka', devanagari: 'क' },
        { char: 'ඛ', roman: 'kha', devanagari: 'ख' },
        { char: 'ග', roman: 'ga', devanagari: 'ग' },
        { char: 'ඝ', roman: 'gha', devanagari: 'घ' },
        { char: 'ඞ', roman: 'nga', devanagari: 'ङ' },
        { char: 'ච', roman: 'cha', devanagari: 'च' },
        { char: 'ඡ', roman: 'chha', devanagari: 'छ' },
        { char: 'ජ', roman: 'ja', devanagari: 'ज' },
        { char: 'ඣ', roman: 'jha', devanagari: 'झ' },
        { char: 'ඤ', roman: 'nya', devanagari: 'ञ' },
        { char: 'ට', roman: 'ṭa', devanagari: 'ट' },
        { char: 'ඨ', roman: 'ṭha', devanagari: 'ठ' },
        { char: 'ඩ', roman: 'ḍa', devanagari: 'ड' },
        { char: 'ඪ', roman: 'ḍha', devanagari: 'ढ' },
        { char: 'ණ', roman: 'ṇa', devanagari: 'ण' },
        { char: 'ත', roman: 'ta', devanagari: 'त' },
        { char: 'ථ', roman: 'tha', devanagari: 'थ' },
        { char: 'ද', roman: 'da', devanagari: 'द' },
        { char: 'ඳ', roman: 'nda', devanagari: 'ंद' },
        { char: 'ධ', roman: 'dha', devanagari: 'ध' },
        { char: 'න', roman: 'na', devanagari: 'न' },
        { char: 'ප', roman: 'pa', devanagari: 'प' },
        { char: 'ඵ', roman: 'pha', devanagari: 'फ' },
        { char: 'ෆ', roman: 'fa', devanagari: 'फ' },
        { char: 'බ', roman: 'ba', devanagari: 'ब' },
        { char: 'ඹ', roman: 'mba', devanagari: 'ंब' },
        { char: 'භ', roman: 'bha', devanagari: 'भ' },
        { char: 'ම', roman: 'ma', devanagari: 'म' },
        { char: 'ය', roman: 'ya', devanagari: 'य' },
        { char: 'ර', roman: 'ra', devanagari: 'र' },
        { char: 'ල', roman: 'la', devanagari: 'ल' },
        { char: 'ව', roman: 'va', devanagari: 'व' },
        { char: 'ශ', roman: 'śa', devanagari: 'श' },
        { char: 'ෂ', roman: 'sha', devanagari: 'ष' },
        { char: 'ස', roman: 'sa', devanagari: 'स' },
        { char: 'හ', roman: 'ha', devanagari: 'ह' },
        { char: 'ළ', roman: 'ḷa', devanagari: 'ळ' },
        { char: 'ක්ෂ', roman: 'ksha', devanagari: 'क्ष' },
        { char: 'ඥ', roman: 'dnya', devanagari: 'ज्ञ' },
        { char: 'අ', roman: 'a', devanagari: 'अ' },
    ],

    // Vowel signs (dependent vowels/matras) — from Intermediate sheet
    vowels: [
        { char: 'ා', roman: 'ā', devanagari: 'ा', name: 'aa' },
        { char: 'ි', roman: 'i', devanagari: 'ि', name: 'i' },
        { char: 'ී', roman: 'ī', devanagari: 'ी', name: 'ee' },
        { char: 'ු', roman: 'u', devanagari: 'ु', name: 'u' },
        { char: 'ූ', roman: 'ū', devanagari: 'ू', name: 'oo' },
        { char: 'ෙ', roman: 'e', devanagari: 'े', name: 'e1' },
        { char: 'ේ', roman: 'ē', devanagari: 'े', name: 'e2' },
        { char: 'ෛ', roman: 'ai', devanagari: 'ै', name: 'ai' },
        { char: 'ො', roman: 'o', devanagari: 'ो', name: 'o1' },
        { char: 'ෝ', roman: 'ō', devanagari: 'ो', name: 'o2' },
        { char: 'ෟ', roman: 'au', devanagari: 'ौ', name: 'ou1' },
        { char: 'ෞ', roman: 'au', devanagari: 'ौ', name: 'ou2' },
        { char: 'ැ', roman: 'æ', devanagari: 'ॅ', name: 'ae1' },
        { char: 'ෑ', roman: 'ǣ', devanagari: 'ॅ', name: 'ae2' },
        { char: 'ෘ', roman: 'ru', devanagari: 'ृ', name: 'ru' },
        { char: 'ෲ', roman: 'rū', devanagari: 'ॄ', name: 'ruu' },
    ],

    // Independent vowels (for standalone usage)
    independentVowels: [
        { char: 'අ', roman: 'a', devanagari: 'अ' },
        { char: 'ආ', roman: 'ā', devanagari: 'आ' },
        { char: 'ඉ', roman: 'i', devanagari: 'इ' },
        { char: 'ඊ', roman: 'ī', devanagari: 'ई' },
        { char: 'උ', roman: 'u', devanagari: 'उ' },
        { char: 'ඌ', roman: 'ū', devanagari: 'ऊ' },
        { char: 'එ', roman: 'e', devanagari: 'ए' },
        { char: 'ඒ', roman: 'ē', devanagari: 'ए' },
        { char: 'ඇ', roman: 'æ', devanagari: 'ॲ' },
        { char: 'ඔ', roman: 'o', devanagari: 'ओ' },
        { char: 'ඕ', roman: 'ō', devanagari: 'ओ' },
    ],

    // Medial consonants (not applicable in Sinhala like Burmese, but keeping structure)
    medials: [],

    // Final consonant markers and special signs
    finals: [
        { char: '්', roman: '', devanagari: '्', name: 'virama/hal' },
        { char: 'ං', roman: 'ṃ', devanagari: 'ं', name: 'anusvara' },
        { char: 'ඁ', roman: 'ṁ', devanagari: 'ँ', name: 'chandrabindu' },
        { char: 'ඃ', roman: 'ḥ', devanagari: 'ः', name: 'visarga' },
    ],

    // Common combined forms (for more accurate conversion)
    combinations: [
        // Conjunct consonants
        { char: 'ක්ෂ', roman: 'ksha', devanagari: 'क्ष' },
        { char: 'ඥ', roman: 'dnya', devanagari: 'ज्ञ' },
        // Prenasalized stops (unique to Sinhala)
        { char: 'ඳ', roman: 'nda', devanagari: 'ंद' },
        { char: 'ඹ', roman: 'mba', devanagari: 'ंब' },
    ],

    hasDevanagari: true
};

// Make it available globally (for non-module usage)
if (typeof window !== 'undefined') {
    window.sinhala = sinhala;
}
