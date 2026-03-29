// Burmese (Myanmar) Language Data
const burmese = {
    id: 'burmese',
    name: 'Burmese',
    native: 'မြန်မာ',
    fontClass: 'burmese',
    fontFamily: 'Noto Sans Myanmar',
    
    // Basic Consonants (K, S, T, P Groups) + Independent Vowels
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
        { char: 'ဉ ', roman: 'nya', devanagari: 'ञ' },     // with trailing space (original)
        { char: 'ဉ', roman: 'nya', devanagari: 'ञ' },      // FIX: without space — was leaking as U+1009
        { char: 'ည', roman: 'nyya', devanagari: 'ञ' },
        { char: 'ဋ', roman: 'ṭa', devanagari: 'ट' },
        { char: 'ဌ', roman: 'ṭha', devanagari: 'ठ' },
        { char: 'ဍ', roman: 'ḍa', devanagari: 'ड' },
        { char: 'ဎ', roman: 'ḍha', devanagari: 'ढ' },
        { char: 'ဏ', roman: 'ṇa', devanagari: 'ण' },
        { char: 'တ', roman: 'ta', devanagari: 'त' },
        { char: 'ထ', roman: 'tha', devanagari: 'थ' },
        { char: 'သ', roman: 'sa', devanagari: 'थ' },
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
        { char: 'စ', roman: 'ca', devanagari: 'स' },
        { char: 'ဆ', roman: 'cha', devanagari: 'स' },
        { char: 'ဿ', roman: 'ssa', devanagari: 'स्स' },
        { char: 'ဟ', roman: 'ha', devanagari: 'ह' },
        { char: 'ဠ', roman: 'ḷa', devanagari: 'ळ' },
        { char: 'အ', roman: 'a', devanagari: 'अ' },
        // === Independent Vowels (FIX: were missing, causing leaks) ===
        { char: 'ဥ', roman: 'u', devanagari: 'उ' },       // U+1025 — leaked in Egg, Yogurt, Carrot, Vinegar
        { char: 'ဦ', roman: 'ū', devanagari: 'ऊ' },       // U+1026 — leaked in Head, Spring, Autumn, Winter
        { char: 'ဧ', roman: 'e', devanagari: 'ए' },       // U+1027 — leaked in April
        { char: 'ဣ', roman: 'i', devanagari: 'इ' },       // U+1023 — independent i (preemptive)
        { char: 'ဤ', roman: 'ī', devanagari: 'ई' },       // U+1024 — independent ii (preemptive)
        { char: 'ဩ', roman: 'o', devanagari: 'ओ' },       // U+1029 — independent o (preemptive)
        { char: 'ဪ', roman: 'au', devanagari: 'औ' },      // U+102A — independent au (preemptive)
    ],

    // Vowel signs (dependent vowels/matras)
    vowels: [
        { char: 'ါ', roman: 'ā', devanagari: 'ा', name: 'aa' },
        { char: 'ာ', roman: 'ā', devanagari: 'ा', name: 'aa-alt' },
        { char: 'ိ', roman: 'i', devanagari: 'ि', name: 'i' },
        { char: 'ီ', roman: 'ī', devanagari: 'ी', name: 'ii' },
        { char: 'ု', roman: 'u', devanagari: 'ु', name: 'u' },
        { char: 'ူ', roman: 'ū', devanagari: 'ू', name: 'uu' },
        { char: 'ေ', roman: 'e', devanagari: 'े', name: 'e' },
        { char: 'ဲ', roman: 'ai', devanagari: 'ै', name: 'ai' },
        { char: 'ော', roman: 'o', devanagari: 'ो', name: 'o' },
        { char: 'ို', roman: 'o', devanagari: 'ो', name: 'o-alt' }
    ],

    // Medial consonants
    medials: [
        { char: 'ျ', roman: 'y', devanagari: '्य', name: 'ya-medial' },
        { char: 'ြ', roman: 'y', devanagari: '्य', name: 'ya-medial' },
        { char: 'ွ', roman: 'w', devanagari: '्व', name: 'wa-medial' },
        { char: 'ှ', roman: 'h', devanagari: '्ह', name: 'ha-medial' }
    ],

    // Final consonant markers
    finals: [
        { char: '်', roman: '', devanagari: '्', name: 'asat/virama' },
        { char: 'ံ', roman: 'ṃ', devanagari: 'ं', name: 'anusvara' },
        { char: '့', roman: '', devanagari: '\u200B', name: 'dot-below' },  // FIX: U+1037 — map to zero-width space (consumed but invisible). Was '' which left the Myanmar char in output.
        { char: 'း', roman: 'ḥ', devanagari: 'ः', name: 'visarga' },
        // === FIX: Missing markers ===
        { char: '္', roman: '', devanagari: '्', name: 'stacked/virama' }, // U+1039 — stacked consonant marker → Devanagari virama. Leaked in Orange, Taxi, etc.
        { char: '။', roman: '.', devanagari: '।', name: 'fullstop' },      // U+104B — Myanmar full stop → Devanagari danda. Leaked in 17 sentence-type words.
        { char: '၊', roman: ',', devanagari: ',', name: 'comma' },          // U+104A — Myanmar comma (preemptive)
    ],

    // Common combined forms (for more accurate conversion)
    combinations: [
        { char: 'ောင်', roman: 'aung', devanagari: 'ौंग्' },
        { char: 'ိုင်', roman: 'aing', devanagari: 'ैंग्' },
        { char: 'ောက်', roman: 'auk', devanagari: 'ौक्' },
        { char: 'ိုက်', roman: 'aik', devanagari: 'ैक्' },
        { char: 'ုံ', roman: 'un', devanagari: 'ुं' },
        { char: 'ိန်', roman: 'in', devanagari: 'िन्' },
        { char: 'ိမ်', roman: 'im', devanagari: 'िम्' },
        { char: 'ိတ်', roman: 'it', devanagari: 'ित्' },
        { char: 'ိပ်', roman: 'ip', devanagari: 'िप्' },
        { char: 'ိက်', roman: 'ik', devanagari: 'िक्' },
        { char: 'ုတ်', roman: 'ut', devanagari: 'ुत्' },
        { char: 'ုပ်', roman: 'up', devanagari: 'ुप्' },
        { char: 'ုက်', roman: 'uk', devanagari: 'ुक्' },
        { char: 'န်', roman: 'n', devanagari: 'न्' },
        { char: 'မ်', roman: 'm', devanagari: 'म्' },
        { char: 'တ်', roman: 't', devanagari: 'त्' },
        { char: 'ပ်', roman: 'p', devanagari: 'प्' },
        { char: 'က်', roman: 'k', devanagari: 'क्' },
        { char: 'င်', roman: 'ng', devanagari: 'ं' },
        { char: 'င်္', roman: 'ng', devanagari: 'ं' },
        { char: 'ွန်', roman: 'un', devanagari: 'ुन', name: 'un' },
        { char: 'ုန်', roman: 'on', devanagari: 'ोन', name: 'on' },
        // === FIX: Stacked consonant combinations (္ + consonant) ===
        { char: '္မ', roman: 'mma', devanagari: '्म', name: 'stacked-ma' },  // For လိမ္မော် (Orange)
        { char: '္က', roman: 'kka', devanagari: '्क', name: 'stacked-ka' },  // For တက္ကစီ (Taxi)
        { char: '္စ', roman: 'cca', devanagari: '्स', name: 'stacked-ca' },
        { char: '္ခ', roman: 'kkha', devanagari: '्ख', name: 'stacked-kha' },
        { char: '္ဂ', roman: 'gga', devanagari: '्ग', name: 'stacked-ga' },
        { char: '္တ', roman: 'tta', devanagari: '्त', name: 'stacked-ta' },
        { char: '္ဒ', roman: 'dda', devanagari: '्द', name: 'stacked-da' },
        { char: '္ပ', roman: 'ppa', devanagari: '्प', name: 'stacked-pa' },
        { char: '္ဗ', roman: 'bba', devanagari: '्ब', name: 'stacked-ba' },
        { char: '္န', roman: 'nna', devanagari: '्न', name: 'stacked-na' },
        { char: '္လ', roman: 'lla', devanagari: '्ल', name: 'stacked-la' },
        { char: '္သ', roman: 'ssa', devanagari: '्थ', name: 'stacked-sa' },
    ],

    hasDevanagari: true
};

// Make it available globally (for non-module usage)
if (typeof window !== 'undefined') {
    window.burmese = burmese;
}
