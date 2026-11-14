// ═══ TELUGU TRANSLITERATION ENGINE ═══
// Character-by-character mapping, longest-match-first (same pattern as sinhala.js).
// Telugu is phonemic — no positional voicing rules needed.
// toRoman() gives an ISO 15919 style spelling, as in kannada.js (కుక్క kukka, ఏనుగు ēnugu, పళ్ళెం paḷḷem), with one
//   change for Telugu: ం is spoken m at the end of a word and before y r l v ś ṣ s h, so it is written m there
//   (అన్నం annam, సింహం simham, సంవత్సరం samvatsaram). Before k c ṭ t p it takes their nasal (రంగు raṅgu, పంది pandi).
// Exports: toDev(text), toRoman(text), breakSyllables(word), toPronunciation (alias of toDev)

const CONSONANTS = [
  { char: 'క', dev: 'क' }, { char: 'ఖ', dev: 'ख' }, { char: 'గ', dev: 'ग' }, { char: 'ఘ', dev: 'घ' }, { char: 'ఙ', dev: 'ङ' },
  { char: 'చ', dev: 'च' }, { char: 'ఛ', dev: 'छ' }, { char: 'జ', dev: 'ज' }, { char: 'ఝ', dev: 'झ' }, { char: 'ఞ', dev: 'ञ' },
  { char: 'ట', dev: 'ट' }, { char: 'ఠ', dev: 'ठ' }, { char: 'డ', dev: 'ड' }, { char: 'ఢ', dev: 'ढ' }, { char: 'ణ', dev: 'ण' },
  { char: 'త', dev: 'त' }, { char: 'థ', dev: 'थ' }, { char: 'ద', dev: 'द' }, { char: 'ధ', dev: 'ध' }, { char: 'న', dev: 'न' },
  { char: 'ప', dev: 'प' }, { char: 'ఫ', dev: 'फ' }, { char: 'బ', dev: 'ब' }, { char: 'భ', dev: 'भ' }, { char: 'మ', dev: 'म' },
  { char: 'య', dev: 'य' }, { char: 'ర', dev: 'र' }, { char: 'ఱ', dev: 'ऱ' }, { char: 'ల', dev: 'ल' }, { char: 'ళ', dev: 'ळ' }, { char: 'వ', dev: 'व' },
  { char: 'శ', dev: 'श' }, { char: 'ష', dev: 'ष' }, { char: 'స', dev: 'स' }, { char: 'హ', dev: 'ह' },
  // Independent vowels
  { char: 'అ', dev: 'अ' }, { char: 'ఆ', dev: 'आ' }, { char: 'ఇ', dev: 'इ' }, { char: 'ఈ', dev: 'ई' }, { char: 'ఉ', dev: 'उ' }, { char: 'ఊ', dev: 'ऊ' },
  { char: 'ఋ', dev: 'ऋ' }, { char: 'ౠ', dev: 'ॠ' }, { char: 'ఎ', dev: 'ए' }, { char: 'ఏ', dev: 'ए' }, { char: 'ఐ', dev: 'ऐ' },
  { char: 'ఒ', dev: 'ओ' }, { char: 'ఓ', dev: 'ओ' }, { char: 'ఔ', dev: 'औ' },
];

const VOWELS = [
  { char: 'ా', dev: 'ा' }, { char: 'ి', dev: 'ि' }, { char: 'ీ', dev: 'ी' }, { char: 'ు', dev: 'ु' }, { char: 'ూ', dev: 'ू' },
  { char: 'ృ', dev: 'ृ' }, { char: 'ౄ', dev: 'ॄ' }, { char: 'ె', dev: 'े' }, { char: 'ే', dev: 'े' }, { char: 'ై', dev: 'ै' },
  { char: 'ొ', dev: 'ो' }, { char: 'ో', dev: 'ो' }, { char: 'ౌ', dev: 'ौ' },
];

const FINALS = [
  { char: '్', dev: '्' },   // virama
  { char: 'ం', dev: 'ं' },   // anusvara
  { char: 'ఁ', dev: 'ँ' },   // candrabindu
  { char: 'ః', dev: 'ः' },   // visarga
];

const COMBINATIONS = [
  { char: 'క్ష', dev: 'क्ष' },
  { char: 'జ్ఞ', dev: 'ज्ञ' },
];

const DIGITS = { '౦': '०', '౧': '१', '౨': '२', '౩': '३', '౪': '४', '౫': '५', '౬': '६', '౭': '७', '౮': '८', '౯': '९' };

// ─── BUILD LOOKUP (longest-match-first) ───
const allMappings = {};
for (const c of COMBINATIONS) allMappings[c.char] = c.dev;
for (const c of CONSONANTS) allMappings[c.char] = c.dev;
for (const v of VOWELS) allMappings[v.char] = v.dev;
for (const f of FINALS) allMappings[f.char] = f.dev;
for (const d in DIGITS) allMappings[d] = DIGITS[d];
const sortedKeys = Object.keys(allMappings).sort((a, b) => b.length - a.length);

export function toDev(telugu) {
  if (!telugu) return '';
  const text = telugu.normalize('NFC').trim();
  let result = '';
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const key of sortedKeys) {
      if (text.startsWith(key, i)) { result += allMappings[key]; i += key.length; matched = true; break; }
    }
    if (!matched) { result += text[i]; i++; }
  }
  return result;
}

// ─── ROMAN (ISO 15919 style, final a kept) ───
const R_CONS = {
  'క': 'k', 'ఖ': 'kh', 'గ': 'g', 'ఘ': 'gh', 'ఙ': 'ṅ', 'చ': 'c', 'ఛ': 'ch', 'జ': 'j', 'ఝ': 'jh', 'ఞ': 'ñ',
  'ట': 'ṭ', 'ఠ': 'ṭh', 'డ': 'ḍ', 'ఢ': 'ḍh', 'ణ': 'ṇ', 'త': 't', 'థ': 'th', 'ద': 'd', 'ధ': 'dh', 'న': 'n',
  'ప': 'p', 'ఫ': 'ph', 'బ': 'b', 'భ': 'bh', 'మ': 'm', 'య': 'y', 'ర': 'r', 'ఱ': 'ṟ', 'ల': 'l', 'ళ': 'ḷ', 'ఴ': 'ḻ',
  'వ': 'v', 'శ': 'ś', 'ష': 'ṣ', 'స': 's', 'హ': 'h', 'ౘ': 'ts', 'ౙ': 'dz',
};
const R_VOW = { 'అ': 'a', 'ఆ': 'ā', 'ఇ': 'i', 'ఈ': 'ī', 'ఉ': 'u', 'ఊ': 'ū', 'ఋ': 'r̥', 'ౠ': 'r̥̄', 'ఎ': 'e', 'ఏ': 'ē', 'ఐ': 'ai', 'ఒ': 'o', 'ఓ': 'ō', 'ఔ': 'au' };
const R_SIGN = { 'ా': 'ā', 'ి': 'i', 'ీ': 'ī', 'ు': 'u', 'ూ': 'ū', 'ృ': 'r̥', 'ౄ': 'r̥̄', 'ె': 'e', 'ే': 'ē', 'ై': 'ai', 'ొ': 'o', 'ో': 'ō', 'ౌ': 'au' };
const R_VIRAMA = '్', R_NUKTA = '఼';
const R_NASAL = { k: 'ṅ', kh: 'ṅ', g: 'ṅ', gh: 'ṅ', c: 'ñ', ch: 'ñ', j: 'ñ', jh: 'ñ', 'ṭ': 'ṇ', 'ṭh': 'ṇ', 'ḍ': 'ṇ', 'ḍh': 'ṇ',
  t: 'n', th: 'n', d: 'n', dh: 'n', n: 'n', p: 'm', ph: 'm', b: 'm', bh: 'm', m: 'm' };

export function toRoman(text) {
  const chars = Array.from((text || '').normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (R_CONS[ch]) {
      let r = R_CONS[ch];
      if (chars[i + 1] === R_NUKTA) { r = { 'జ': 'z', 'ఫ': 'f' }[ch] || r; i++; }
      out += r;
      const nx = chars[i + 1];
      if (nx === R_VIRAMA) { i++; continue; }
      if (R_SIGN[nx]) { out += R_SIGN[nx]; i++; continue; }
      out += 'a';
      continue;
    }
    if (R_VOW[ch]) { out += R_VOW[ch]; continue; }
    if (ch === 'ం') {
      // anusvara takes the nasal of the next stop (k c ṭ t p groups); m everywhere else, as it is spoken
      const nx = chars[i + 1];
      out += (R_CONS[nx] && R_NASAL[R_CONS[nx]]) || 'm';
      continue;
    }
    if (ch === 'ఁ' || ch === 'ఀ') { out += 'm̐'; continue; }   // arasunna / candrabindu (old spellings)
    if (ch === 'ః') { out += 'ḥ'; continue; }
    if (ch === '\u200C' || ch === '\u200D') continue;      // ZWNJ / ZWJ only change the shape
    const c = ch.codePointAt(0);
    if (c >= 0x0C66 && c <= 0x0C6F) { out += String(c - 0x0C66); continue; }
    out += ch;
  }
  return out;
}

// ─── SYLLABLE BREAKDOWN ───
export function breakSyllables(word) {
  if (!word) return [];
  const text = word.normalize('NFC');
  const syllables = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.codePointAt(0);
    // Telugu independent vowels U+0C05–0C14, consonants U+0C15–0C39
    const startsSyllable = code >= 0x0C05 && code <= 0x0C39;
    if (startsSyllable && current && !current.endsWith('్')) { syllables.push(current); current = ch; continue; }
    current += ch;
  }
  if (current) syllables.push(current);
  return syllables;
}

export const toPronunciation = toDev;
