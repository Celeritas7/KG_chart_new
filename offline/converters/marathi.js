// ═══ MARATHI TRANSLITERATION ENGINE ═══
// Marathi is written in Devanagari, so toDev() returns the text unchanged (NFC only).
// toRoman() gives a plain spelling for readers of Filipino or English (no accent marks: manjar, mangalvar,
// sanga, teksi; ng/ny/sh; f for फ; a nasal before k/kh/g/gh is plain n, so सांगा → sanga, not sangga). toRomanStrict() keeps the marks (mānjar, maṅgaḷvār, ṭæksī). Both use Marathi rules:
//   • the inherent a after a word's last consonant is silent         मांजर → mānjar
//   • a medial inherent a is silent in  V C a C V  (checked right to left) मंगळवार → maṅgaḷvār
//   • ज्ञ is said dny, ऋ is said ru                                     ज्ञान → dnyān
//   • ॅ / ऑ are the English vowels in "cat" / "cot"                    टॅक्सी → ṭæksī, कॉफी → kŏphī
//   • ँ on a bare consonant is the "cat" vowel plus a nasal            सँडविच → sænḍvich
// Exports: toDev(text), toRoman(text), toRomanStrict(text), breakSyllables(word)

const VIRAMA = '्', NUKTA = '़';

const CONS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ṅ',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ñ',
  'ट': 'ṭ', 'ठ': 'ṭh', 'ड': 'ḍ', 'ढ': 'ḍh', 'ण': 'ṇ',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'ळ': 'ḷ',
  'श': 'sh', 'ष': 'ṣh', 'स': 's', 'ह': 'h',
};
const NUKTA_CONS = { 'क': 'q', 'ख': 'kh', 'ग': 'gh', 'ज': 'z', 'ड': 'ṛ', 'ढ': 'ṛh', 'फ': 'f' };
const PRECOMPOSED = { 'क़': 'क', 'ख़': 'ख', 'ग़': 'ग', 'ज़': 'ज', 'ड़': 'ड', 'ढ़': 'ढ', 'फ़': 'फ' };

const VOWELS = {
  'अ': 'a', 'आ': 'ā', 'इ': 'i', 'ई': 'ī', 'उ': 'u', 'ऊ': 'ū', 'ऋ': 'ru',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऍ': 'æ', 'ॲ': 'æ', 'ऑ': 'ŏ', 'ऎ': 'e', 'ऒ': 'o',
};
const SIGNS = {
  'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū', 'ृ': 'ru',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'æ', 'ॉ': 'ŏ', 'ॆ': 'e', 'ॊ': 'o',
};
// Anusvara before a consonant takes that consonant's nasal
const NASAL_BEFORE = { k: 'ṅ', kh: 'ṅ', g: 'ṅ', gh: 'ṅ', p: 'm', ph: 'm', b: 'm', bh: 'm', m: 'm', f: 'm' };

const isDev = (ch) => !!ch && ch >= 'ऀ' && ch <= 'ॿ';

// One word → list of tokens: { t: 'C', r } consonant, { t: 'V', r } vowel, { t: 'a' } inherent a, { t: 'N' } anusvara, { t: 'X', r } other
function tokenize(word) {
  const out = [];
  const chars = Array.from(word);
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (PRECOMPOSED[ch]) { ch = PRECOMPOSED[ch]; chars.splice(i + 1, 0, NUKTA); }
    if (CONS[ch]) {
      let r = CONS[ch];
      if (chars[i + 1] === NUKTA) { r = NUKTA_CONS[ch] || r; i++; }
      // ज्ञ → dny
      if (ch === 'ज' && chars[i + 1] === VIRAMA && chars[i + 2] === 'ञ') { out.push({ t: 'C', r: 'd' }, { t: 'C', r: 'n' }, { t: 'C', r: 'y' }); i += 2; }
      else out.push({ t: 'C', r });
      const nx = chars[i + 1];
      if (nx === VIRAMA) { i++; if (chars[i + 1] === '‍' || chars[i + 1] === '‌') i++; continue; }
      if (SIGNS[nx]) { out.push({ t: 'V', r: SIGNS[nx] }); i++; continue; }
      out.push({ t: 'a' });
      continue;
    }
    if (VOWELS[ch]) { out.push({ t: 'V', r: VOWELS[ch] }); continue; }
    // ँ on a bare consonant marks the English "a" of "cat" plus a nasal: सँडविच → sænḍvich
    if (ch === 'ँ' && out.length && out[out.length - 1].t === 'a') { out[out.length - 1] = { t: 'V', r: 'æ' }; out.push({ t: 'N' }); continue; }
    if (ch === 'ं' || ch === 'ँ') { out.push({ t: 'N' }); continue; }
    if (ch === 'ः') { out.push({ t: 'X', r: 'h' }); continue; }
    if (ch === '‍' || ch === '‌' || ch === NUKTA) continue;
    out.push({ t: 'X', r: ch });
  }
  return out;
}

const vowelish = (tok) => tok && (tok.t === 'V' || tok.t === 'a');

// Plain spelling, applied per token so 'ph' only ever means फ
const PLAIN = { 'ā': 'a', 'ī': 'i', 'ū': 'u', 'ṅ': 'ng', 'ñ': 'ny', 'ṭ': 't', 'ḍ': 'd', 'ṇ': 'n', 'ḷ': 'l', 'ṣ': 's', 'æ': 'e', 'ŏ': 'o', 'ṁ': 'm', 'ṛ': 'r' };
const plainTok = (r) => (r === 'ph' ? 'f' : r.replace(/[āīūṅñṭḍṇḷṣæŏṁṛ]/g, c => PLAIN[c]));

function romanWord(word, plain) {
  const toks = tokenize(word);
  // word-final inherent a is silent (a one-letter word like न keeps it)
  const consonants = toks.filter(t => t.t === 'C').length;
  if (toks.length && toks[toks.length - 1].t === 'a' && (consonants > 1 || toks.some(t => t.t === 'V'))) toks[toks.length - 1].drop = true;
  // medial: V C a C V → drop the a, right to left, never in the first syllable.
  // The postposition कडे / कडून keeps its a: डावीकडे → ḍāvīkaḍe
  const keep = new Set();
  const m = word.match(/कड(?:े|ून)$/);
  if (m) { const k = tokenize(word.slice(0, m.index)).length + 1; keep.add(k); }
  for (let i = toks.length - 2; i >= 2; i--) {
    const t = toks[i];
    if (t.t !== 'a' || t.drop || keep.has(i)) continue;
    const prevC = toks[i - 1], nextC = toks[i + 1];
    const prevV = toks[i - 2] && toks[i - 2].t === 'N' ? toks[i - 3] : toks[i - 2];  // पांढरा: ā ं ढ a र ā
    let j = i + 2; while (toks[j] && toks[j].t === 'C') j++;
    const nextV = toks[j];
    if (prevC.t === 'C' && vowelish(prevV) && !prevV.drop && nextC && nextC.t === 'C' && toks[i + 2] && toks[i + 2].t !== 'C' && vowelish(nextV) && !nextV.drop) t.drop = true;
  }
  const out = plain ? plainTok : (r) => r;
  let s = '';
  toks.forEach((t, i) => {
    if (t.t === 'a') { if (!t.drop) s += 'a'; return; }
    if (t.t === 'N') {
      const nx = toks[i + 1];
      const nasal = nx && nx.t === 'C' ? (NASAL_BEFORE[nx.r] || 'n') : 'ṁ';
      // Plain: before k/kh/g/gh the nasal is just n (the g or k that follows already gives the "ng" sound):
      // सांगा → sanga, मंगळवार → mangalvar, पंखा → pankha. Strict keeps ṅ (sāṅgā).
      s += plain && nasal === 'ṅ' ? 'n' : out(nasal);
      return;
    }
    s += out(t.r);
  });
  return s;
}

function mrRoman(text, plain) {
  return (text || '').normalize('NFC').replace(/[\u0900-\u097F\u200C\u200D]+/g, w => romanWord(w, plain));
}

export function toDev(text) { return (text || '').normalize('NFC'); }
export function toRoman(text) { return mrRoman(text, true); }
export function toRomanStrict(text) { return mrRoman(text, false); }
export const toPronunciation = toRoman;

// Akshara split for Build the Word: a conjunct stays in one piece (क्ष, स्त्र), vowel signs and
// ं ँ ः stay on their letter. Rebuilds the exact word.
const AKSHARA = /(?:[क-हक़-य़ॸ-ॿ]़?(?:्[‌‍]?[क-हक़-य़ॸ-ॿ]़?)*्?[‌‍]?|[ऄ-औॠॡॲ-ॷ])[ऺऻा-ौॎॏॕ-ॗॢॣ]*[ऀ-ः]*|[\s\S]/gu;
export function breakSyllables(word) {
  return ((word || '').normalize('NFC').match(AKSHARA) || []);
}
