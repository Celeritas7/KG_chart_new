// ═══ KANNADA TRANSLITERATION ENGINE ═══
// Kannada and Devanagari are parallel Brahmic scripts (Unicode lays them out in the same order),
// so most letters map one to one: ಕ → क, ಳ → ळ, ಱ → ऱ, ್ → ्.
// Exceptions handled here:
//   • short e / o (ಎ ಒ ೆ ೊ) have no everyday Devanagari letter, so they become ए ओ े ो (as in telugu.js)
//   • ೞ (old letter) → ळ
//   • Kannada keeps the final a: ಕನ್ನಡ is kannaḍa, not kannaḍ. toRoman() shows it.
// Exports: toDev(text), toRoman(text), breakSyllables(word), toPronunciation (alias of toDev)

const KN_START = 0x0C80, KN_END = 0x0CFF, DEV_OFFSET = 0x0900 - 0x0C80;
const SPECIAL_DEV = {
  'ಎ': 'ए', 'ಒ': 'ओ', 'ೆ': 'े', 'ೊ': 'ो',  // short e / o
  'ೞ': 'ळ', 'ೕ': '', 'ೖ': '',               // old ḻ; length marks only appear inside ೀ ೇ ೈ ೋ before NFC
  'ಀ': 'ँ', 'ಁ': 'ँ',
};

export function toDev(text) {
  if (!text) return '';
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (SPECIAL_DEV[ch] !== undefined) out += SPECIAL_DEV[ch];
    else if (c >= KN_START && c <= KN_END) {
      const d = String.fromCodePoint(c + DEV_OFFSET);
      out += /\p{L}|\p{M}|\p{N}|\p{P}/u.test(d) ? d : ch;  // unassigned Devanagari slot → keep the Kannada letter
    } else out += ch;
  }
  return out.normalize('NFC');
}

// ─── ROMAN (ISO 15919 style, final a kept) ───
const CONS = {
  'ಕ': 'k', 'ಖ': 'kh', 'ಗ': 'g', 'ಘ': 'gh', 'ಙ': 'ṅ', 'ಚ': 'c', 'ಛ': 'ch', 'ಜ': 'j', 'ಝ': 'jh', 'ಞ': 'ñ',
  'ಟ': 'ṭ', 'ಠ': 'ṭh', 'ಡ': 'ḍ', 'ಢ': 'ḍh', 'ಣ': 'ṇ', 'ತ': 't', 'ಥ': 'th', 'ದ': 'd', 'ಧ': 'dh', 'ನ': 'n',
  'ಪ': 'p', 'ಫ': 'ph', 'ಬ': 'b', 'ಭ': 'bh', 'ಮ': 'm', 'ಯ': 'y', 'ರ': 'r', 'ಱ': 'ṟ', 'ಲ': 'l', 'ಳ': 'ḷ', 'ೞ': 'ḻ',
  'ವ': 'v', 'ಶ': 'ś', 'ಷ': 'ṣ', 'ಸ': 's', 'ಹ': 'h',
};
const VOW = { 'ಅ': 'a', 'ಆ': 'ā', 'ಇ': 'i', 'ಈ': 'ī', 'ಉ': 'u', 'ಊ': 'ū', 'ಋ': 'r̥', 'ೠ': 'r̥̄', 'ಎ': 'e', 'ಏ': 'ē', 'ಐ': 'ai', 'ಒ': 'o', 'ಓ': 'ō', 'ಔ': 'au' };
const SIGN = { 'ಾ': 'ā', 'ಿ': 'i', 'ೀ': 'ī', 'ು': 'u', 'ೂ': 'ū', 'ೃ': 'r̥', 'ೄ': 'r̥̄', 'ೆ': 'e', 'ೇ': 'ē', 'ೈ': 'ai', 'ೊ': 'o', 'ೋ': 'ō', 'ೌ': 'au' };
const VIRAMA = '್', NUKTA = '಼';
const NASAL = { k: 'ṅ', kh: 'ṅ', g: 'ṅ', gh: 'ṅ', c: 'ñ', ch: 'ñ', j: 'ñ', jh: 'ñ', 'ṭ': 'ṇ', 'ṭh': 'ṇ', 'ḍ': 'ṇ', 'ḍh': 'ṇ', p: 'm', ph: 'm', b: 'm', bh: 'm', m: 'm' };

export function toRoman(text) {
  const chars = Array.from((text || '').normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONS[ch]) {
      let r = CONS[ch];
      if (chars[i + 1] === NUKTA) { r = { 'ಜ': 'z', 'ಫ': 'f' }[ch] || r; i++; }
      out += r;
      const nx = chars[i + 1];
      if (nx === VIRAMA) { i++; continue; }
      if (SIGN[nx]) { out += SIGN[nx]; i++; continue; }
      out += 'a';
      continue;
    }
    if (VOW[ch]) { out += VOW[ch]; continue; }
    if (ch === 'ಂ') {
      // anusvara takes the nasal of the next consonant; m at the end of a word
      const nx = chars[i + 1];
      out += CONS[nx] ? (NASAL[CONS[nx]] || 'n') : 'ṁ';
      continue;
    }
    if (ch === 'ಃ') { out += 'h'; continue; }
    if (ch === '‌' || ch === '‍') continue;
    const c = ch.codePointAt(0);
    if (c >= 0x0CE6 && c <= 0x0CEF) { out += String(c - 0x0CE6); continue; }
    out += ch;
  }
  return out;
}

// ─── SYLLABLES (aksharas) ───
// A conjunct stays in one piece (ಕ್ಷ, ಸ್ತ್ರೀ), vowel signs and ಂ ಃ stay on their letter. Rebuilds the exact word.
const AKSHARA = /(?:[ಕ-ಹೞ]಼?(?:್[‌‍]?[ಕ-ಹೞ]಼?)*್?[‌‍]?|[ಅ-ಔೠೡ])[ಾ-ೌೕೖೢೣ]*[ಀ-ಃ]*|[\s\S]/gu;
export function breakSyllables(word) {
  return (word || '').normalize('NFC').match(AKSHARA) || [];
}

export const toPronunciation = toDev;
