// ═══ TAMIL TRANSLITERATION ENGINE ═══
// Tamil → Devanagari / Roman for pronunciation hints.
// Tamil script does not mark voicing: க can be ka or ga depending on position.
// This engine applies the standard positional rules:
//   • word-initial or doubled (க்க)            → voiceless  क   (exception: word-initial ச → स)
//   • after homorganic nasal (ங்க ஞ்ச ண்ட ந்த ம்ப) → voiced, explicit conjunct  ङ्ग ञ्ज ण्ड न्द म्ब
//   • after ர் ய் ழ் or between vowels           → voiced     ग स ड द ब
//   • after any other pulli consonant (ற்க ல்க)  → voiceless  क
// Exports: toDev(text), toRoman(text), breakSyllables(word)

const PULLI = '\u0BCD';       // ்  virama
const AYTHAM = '\u0B83';      // ஃ

// Stops whose voicing depends on position
const STOPS = {
  'க': { hard: 'क', soft: 'ग', nasal: 'ங', devNasal: 'ग', rHard: 'k',  rSoft: 'g',  rNasal: 'g' },
  'ச': { hard: 'च', soft: 'स', nasal: 'ஞ', devNasal: 'ज', rHard: 'ch', rSoft: 's',  rNasal: 'j' },
  'ட': { hard: 'ट', soft: 'ड', nasal: 'ண', devNasal: 'ड', rHard: 'ṭ',  rSoft: 'ḍ',  rNasal: 'ḍ' },
  'த': { hard: 'त', soft: 'द', nasal: 'ந', devNasal: 'द', rHard: 't',  rSoft: 'd',  rNasal: 'd' },
  'ப': { hard: 'प', soft: 'ब', nasal: 'ம', devNasal: 'ब', rHard: 'p',  rSoft: 'b',  rNasal: 'b' },
};
const VOICING_LIQUIDS = new Set(['ர', 'ய', 'ழ']);

// Fixed consonants (no positional variation)
const CONSONANTS = {
  'ங': { dev: 'ङ', rom: 'ng' },
  'ஞ': { dev: 'ञ', rom: 'ny' },
  'ண': { dev: 'ण', rom: 'ṇ' },
  'ந': { dev: 'न', rom: 'n' },
  'ம': { dev: 'म', rom: 'm' },
  'ன': { dev: 'न', rom: 'n' },
  'ய': { dev: 'य', rom: 'y' },
  'ர': { dev: 'र', rom: 'r' },
  'ற': { dev: 'ऱ', rom: 'ṟ' },
  'ல': { dev: 'ल', rom: 'l' },
  'ள': { dev: 'ळ', rom: 'ḷ' },
  'ழ': { dev: 'ऴ', rom: 'zh' },
  'வ': { dev: 'व', rom: 'v' },
  // Grantha letters
  'ஜ': { dev: 'ज', rom: 'j' },
  'ஶ': { dev: 'श', rom: 'ś' },
  'ஷ': { dev: 'ष', rom: 'ṣ' },
  'ஸ': { dev: 'स', rom: 's' },
  'ஹ': { dev: 'ह', rom: 'h' },
};

const INDEP_VOWELS = {
  'அ': { dev: 'अ', rom: 'a' },  'ஆ': { dev: 'आ', rom: 'ā' },
  'இ': { dev: 'इ', rom: 'i' },  'ஈ': { dev: 'ई', rom: 'ī' },
  'உ': { dev: 'उ', rom: 'u' },  'ஊ': { dev: 'ऊ', rom: 'ū' },
  'எ': { dev: 'ए', rom: 'e' },  'ஏ': { dev: 'ए', rom: 'ē' },
  'ஐ': { dev: 'ऐ', rom: 'ai' }, 'ஒ': { dev: 'ओ', rom: 'o' },
  'ஓ': { dev: 'ओ', rom: 'ō' },  'ஔ': { dev: 'औ', rom: 'au' },
};

const VOWEL_SIGNS = {
  'ா': { dev: 'ा', rom: 'ā' },  'ி': { dev: 'ि', rom: 'i' },
  'ீ': { dev: 'ी', rom: 'ī' },  'ு': { dev: 'ु', rom: 'u' },
  'ூ': { dev: 'ू', rom: 'ū' },  'ெ': { dev: 'े', rom: 'e' },
  'ே': { dev: 'े', rom: 'ē' },  'ை': { dev: 'ै', rom: 'ai' },
  'ொ': { dev: 'ो', rom: 'o' },  'ோ': { dev: 'ो', rom: 'ō' },
  'ௌ': { dev: 'ौ', rom: 'au' },
};

// Aytham + grantha = foreign sounds (ஃப = f, ஃஜ = z)
const AYTHAM_COMBOS = { 'ப': { dev: 'फ़', rom: 'f' }, 'ஜ': { dev: 'ज़', rom: 'z' }, 'ஸ': { dev: 'ज़', rom: 'z' } };

const isTamil = (ch) => { if (!ch) return false; const c = ch.codePointAt(0); return c >= 0x0B80 && c <= 0x0BFF; };
const isConsonant = (ch) => !!(STOPS[ch] || CONSONANTS[ch]);

// Decide hard / soft / nasal for a stop at index i
function stopMode(text, i) {
  const ch = text[i], prev = text[i - 1], prev2 = text[i - 2];
  if (text[i + 1] === PULLI && text[i + 2] === ch) return 'hard';  // first half of a doubled stop க்க
  if (!isTamil(prev)) return ch === 'ச' ? 'soft' : 'hard';   // word-initial (ச is /s/: சிவப்பு → सिवप्पु)
  if (prev === PULLI) {
    if (prev2 === ch) return 'hard';                         // doubled க்க
    if (prev2 === STOPS[ch].nasal) return 'nasal';           // ங்க ஞ்ச ண்ட ந்த ம்ப
    if (VOICING_LIQUIDS.has(prev2)) return 'soft';           // ர்க ய்க ழ்க
    return 'hard';                                           // ற்க ல்க ட்க …
  }
  if (prev === AYTHAM) return 'hard';
  return 'soft';                                             // intervocalic
}

// Nasal followed by pulli + homorganic stop → anusvara (skip the pulli)
function nasalIsAnusvara(text, i) {
  const next = text[i + 1], stop = text[i + 2];
  return next === PULLI && STOPS[stop] && STOPS[stop].nasal === text[i];
}

function convert(input, mode) {
  if (!input) return '';
  const text = input.normalize('NFC').trim();
  const rom = mode === 'roman';
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // ஃ + grantha → f / z
    if (ch === AYTHAM) {
      const combo = AYTHAM_COMBOS[text[i + 1]];
      if (combo) { out += rom ? combo.rom : combo.dev; i += 2; out += rom ? inherent(text, i) : ''; continue; }
      out += rom ? 'ḵ' : 'ः'; i++; continue;
    }

    if (STOPS[ch]) {
      const s = STOPS[ch], m = stopMode(text, i);
      out += rom ? s['r' + cap(m)] : (m === 'nasal' ? s.devNasal : s[m]);
      i++; if (rom) out += inherent(text, i); continue;
    }

    if (CONSONANTS[ch]) {
      // Roman only: collapse nasal+pulli before homorganic stop (ங்க → ng, not ngg).
      // Devanagari keeps the explicit conjunct (ङ्ग ञ्ज ण्ड न्द म्ब).
      if (rom && STOPS_BY_NASAL[ch] && nasalIsAnusvara(text, i)) {
        out += nasalRoman(ch); i += 2; continue;              // consume nasal + pulli
      }
      out += rom ? CONSONANTS[ch].rom : CONSONANTS[ch].dev;
      i++; if (rom) out += inherent(text, i); continue;
    }

    if (INDEP_VOWELS[ch]) { out += rom ? INDEP_VOWELS[ch].rom : INDEP_VOWELS[ch].dev; i++; continue; }
    if (VOWEL_SIGNS[ch]) { out += rom ? VOWEL_SIGNS[ch].rom : VOWEL_SIGNS[ch].dev; i++; continue; }
    if (ch === PULLI) { out += rom ? '' : '्'; i++; continue; }

    out += ch; i++;                                          // spaces, punctuation, digits, other scripts
  }
  return out;
}

// Roman only: consonant with no vowel sign / pulli carries inherent 'a'
function inherent(text, i) {
  const next = text[i];
  if (next === PULLI || VOWEL_SIGNS[next]) return '';
  return 'a';
}
function nasalRoman(n) { return { 'ங': 'n', 'ஞ': 'n', 'ண': 'ṇ', 'ந': 'n', 'ம': 'm' }[n]; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
const STOPS_BY_NASAL = { 'ங': 'க', 'ஞ': 'ச', 'ண': 'ட', 'ந': 'த', 'ம': 'ப' };

export function toDev(tamil) { return convert(tamil, 'dev'); }
export function toRoman(tamil) { return convert(tamil, 'roman'); }
export const toPronunciation = toDev;

// Split a word into syllables (consonant clusters stay together)
export function breakSyllables(word) {
  if (!word) return [];
  const text = word.normalize('NFC');
  const syllables = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const startsSyllable = isConsonant(ch) || INDEP_VOWELS[ch];
    if (startsSyllable && current && !current.endsWith(PULLI) && current !== AYTHAM) {
      syllables.push(current); current = ch; continue;
    }
    current += ch;
  }
  if (current) syllables.push(current);
  return syllables;
}
