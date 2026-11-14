// Korean (Hangul) Language Data

export const korean = {
    id: 'korean',
    name: 'Korean',
    native: '한글',
    fontClass: 'korean',
    fontFamily: 'Noto Sans KR',

    consonants: [
        { char: 'ㄱ', roman: 'g/k' },
        { char: 'ㄴ', roman: 'n' },
        { char: 'ㄷ', roman: 'd/t' },
        { char: 'ㄹ', roman: 'r/l' },
        { char: 'ㅁ', roman: 'm' },
        { char: 'ㅂ', roman: 'b/p' },
        { char: 'ㅅ', roman: 's' },
        { char: 'ㅇ', roman: 'ng' },
        { char: 'ㅈ', roman: 'j' },
        { char: 'ㅊ', roman: 'ch' },
        { char: 'ㅋ', roman: 'k' },
        { char: 'ㅌ', roman: 't' },
        { char: 'ㅍ', roman: 'p' },
        { char: 'ㅎ', roman: 'h' },
        // Double consonants
        { char: 'ㄲ', roman: 'kk' },
        { char: 'ㄸ', roman: 'tt' },
        { char: 'ㅃ', roman: 'pp' },
        { char: 'ㅆ', roman: 'ss' },
        { char: 'ㅉ', roman: 'jj' }
    ],

    vowels: [
        { char: 'ㅏ', roman: 'a' },
        { char: 'ㅑ', roman: 'ya' },
        { char: 'ㅓ', roman: 'eo' },
        { char: 'ㅕ', roman: 'yeo' },
        { char: 'ㅗ', roman: 'o' },
        { char: 'ㅛ', roman: 'yo' },
        { char: 'ㅜ', roman: 'u' },
        { char: 'ㅠ', roman: 'yu' },
        { char: 'ㅡ', roman: 'eu' },
        { char: 'ㅣ', roman: 'i' },
        { char: 'ㅐ', roman: 'ae' },
        { char: 'ㅒ', roman: 'yae' },
        { char: 'ㅔ', roman: 'e' },
        { char: 'ㅖ', roman: 'ye' },
        { char: 'ㅘ', roman: 'wa' },
        { char: 'ㅙ', roman: 'wae' },
        { char: 'ㅚ', roman: 'oe' },
        { char: 'ㅝ', roman: 'wo' },
        { char: 'ㅞ', roman: 'we' },
        { char: 'ㅟ', roman: 'wi' },
        { char: 'ㅢ', roman: 'ui' }
    ],

    getDisplayLabel(charData) {
        return charData.roman;
    },

    hasDevanagari: false
};

// ═══ KOREAN TRANSLITERATION ENGINE ═══
// Hangul → Devanagari / Roman for pronunciation hints.
// Hangul spelling is morphophonemic, so the engine applies the main
// sound-change rules at syllable boundaries before rendering:
//   • liaison           받침 + ㅇ moves to the next syllable    음악 → 으막, 맑음 → 말금
//   • ㅎ rules           ㅎ + ㄱㄷㅈ / ㄱㄷㅂㅈ + ㅎ → aspirated   따뜻하다 → 따뜨타다, 좋아 → 조아
//   • palatalisation    ㄷ/ㅌ + 이 → 지/치                       같이 → 가치
//   • nasalisation      ㄱㄷㅂ + ㄴㅁ → ㅇㄴㅁ                    국물 → 궁물
//   • ㄹ rules           ㄴ+ㄹ, ㄹ+ㄴ → ㄹㄹ;  ㅁㅇ+ㄹ → ㄴ;  ㄱㄷㅂ+ㄹ → ㅇㄴㅁ+ㄴ   석류 → 성뉴
//   • tensing           ㄱㄷㅂ + lenis → tense (Devanagari only)  학교 → 학꾜
//   • ㄴ insertion       lexical, so listed per word in KO_SPOKEN   담요 → 담뇨, 식용유 → 식용뉴
// Devanagari: lenis ㄱㄷㅂㅈ are voiceless word-initially (क त प च) and
// voiced between voiced sounds (ग द ब ज); ㅓ → ऑ, ㅡ → उ, ㅜ → ऊ.
// Roman follows the Revised Romanization of Korean (2000).
// Exports: toDev(text), toRoman(text), breakSyllables(word)

const KO_BASE = 0xAC00, KO_LAST = 0xD7A3;
const KO_L = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const KO_V = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
// Final consonants as arrays of jamo (clusters keep both parts for liaison)
const KO_T = [null,['ㄱ'],['ㄲ'],['ㄱ','ㅅ'],['ㄴ'],['ㄴ','ㅈ'],['ㄴ','ㅎ'],['ㄷ'],['ㄹ'],['ㄹ','ㄱ'],['ㄹ','ㅁ'],['ㄹ','ㅂ'],['ㄹ','ㅅ'],['ㄹ','ㅌ'],['ㄹ','ㅍ'],['ㄹ','ㅎ'],['ㅁ'],['ㅂ'],['ㅂ','ㅅ'],['ㅅ'],['ㅆ'],['ㅇ'],['ㅈ'],['ㅊ'],['ㅋ'],['ㅌ'],['ㅍ'],['ㅎ']];

// Neutralised final sound of a coda (7 representative sounds)
const KO_CODA_SOUND = {
  'ㄱ':'k','ㄲ':'k','ㅋ':'k','ㄱㅅ':'k','ㄹㄱ':'k',
  'ㄴ':'n','ㄴㅈ':'n','ㄴㅎ':'n',
  'ㄷ':'t','ㅅ':'t','ㅆ':'t','ㅈ':'t','ㅊ':'t','ㅌ':'t','ㅎ':'t',
  'ㄹ':'l','ㄹㅂ':'l','ㄹㅅ':'l','ㄹㅌ':'l','ㄹㅎ':'l',
  'ㅁ':'m','ㄹㅁ':'m',
  'ㅂ':'p','ㅍ':'p','ㅂㅅ':'p','ㄹㅍ':'p',
  'ㅇ':'ng'
};
const KO_LENIS = { 'ㄱ':'ㄲ','ㄷ':'ㄸ','ㅂ':'ㅃ','ㅅ':'ㅆ','ㅈ':'ㅉ' };
const KO_ASPIRATE = { 'ㄱ':'ㅋ','ㄷ':'ㅌ','ㅈ':'ㅊ','ㅂ':'ㅍ' };
const KO_ASPIRATE_BEFORE_H = { 'ㄱ':'ㅋ','ㄲ':'ㅋ','ㄷ':'ㅌ','ㅅ':'ㅌ','ㅆ':'ㅌ','ㅈ':'ㅊ','ㅊ':'ㅊ','ㅌ':'ㅌ','ㅂ':'ㅍ' };
const KO_OBSTRUENT = new Set(['k','t','p']);
const KO_RG_NOUNS = new Set(['닭','흙','칡']);   // nouns keep ㄺ = ㄱ before ㄱ: 닭고기 → 닥꼬기
// Words whose pronunciation differs from their spelling in ways no rule predicts
// (ㄴ insertion at compound boundaries, and other lexical exceptions). Add to this list as needed.
const KO_SPOKEN = { '담요': '담뇨', '식용유': '식용뉴', '꽃잎': '꼰닙', '색연필': '색년필', '한여름': '한녀름', '밟다': '밥다' };
const KO_NASALISE = { k:'ng', t:'n', p:'m' };

const isHangul = (ch) => { if (!ch) return false; const c = ch.codePointAt(0); return c >= KO_BASE && c <= KO_LAST; };

function koDecompose(ch) {
  const c = ch.codePointAt(0) - KO_BASE;
  return { ch, L: KO_L[Math.floor(c / 588)], V: KO_V[Math.floor((c % 588) / 28)], T: KO_T[c % 28] ? [...KO_T[c % 28]] : null };
}

// Apply boundary sound changes to one word (array of syllables).
// Each syllable gets: onset (jamo or 'ㅇ'), vowel, coda (sound class or null), tense (bool).
function koPhonology(word) {
  const s = [...(KO_SPOKEN[word] || word)].map(koDecompose);
  for (let i = 0; i < s.length; i++) {
    const cur = s[i], next = s[i + 1];
    if (next && cur.T) {
      const t = cur.T, last = t[t.length - 1];
      if (next.L === 'ㅇ' && last !== 'ㅇ') {
        // Liaison (and silent ㅎ before a vowel)
        if (last === 'ㅎ') { t.pop(); if (t.length) next.L = t.pop(); }   // 좋아 → 조아, 많아 → 마나
        else {
          let moved = t.pop();
          if (moved === 'ㄷ' && next.V === 'ㅣ') moved = 'ㅈ';
          if (moved === 'ㅌ' && next.V === 'ㅣ') moved = 'ㅊ';
          if (moved === 'ㅅ' && t.length) moved = 'ㅆ';   // ㄳ ㅄ ㄽ: second ㅅ is tense
          next.L = moved;
        }
        if (!t.length) cur.T = null;
      } else if (last === 'ㅎ' && KO_ASPIRATE[next.L] && next.L !== 'ㅂ') {
        next.L = KO_ASPIRATE[next.L]; t.pop(); if (!t.length) cur.T = null;   // 좋다 → 조타
      } else if (last === 'ㅎ' && next.L === 'ㅅ') {
        next.L = 'ㅆ'; t.pop(); if (!t.length) cur.T = null;                // 좋소 → 조쏘
      } else if (next.L === 'ㅎ' && KO_ASPIRATE_BEFORE_H[last]) {
        next.L = KO_ASPIRATE_BEFORE_H[last]; t.pop(); if (!t.length) cur.T = null;   // 축하 → 추카
      }
    }
    if (cur.T) {
      const key = cur.T.join('');
      cur.coda = KO_CODA_SOUND[key] || null;
      // ㄺ before ㄱ is pronounced ㄹ in verb and adjective stems (읽고 → 일꼬, 읽기 → 일끼)
      if (key === 'ㄹㄱ' && next && next.L === 'ㄱ' && !KO_RG_NOUNS.has(cur.ch)) { cur.coda = 'l'; next.tense = true; }
    } else cur.coda = null;
  }
  // Consonant assimilation across boundaries (second pass, on sound classes)
  for (let i = 0; i < s.length - 1; i++) {
    const cur = s[i], next = s[i + 1];
    if (!cur.coda) continue;
    if (cur.coda === 'n' && next.L === 'ㄹ') cur.coda = 'l';                    // 신라 → 실라
    else if (cur.coda === 'l' && next.L === 'ㄴ') next.L = 'ㄹ';                // 설날 → 설랄
    else if ((cur.coda === 'm' || cur.coda === 'ng') && next.L === 'ㄹ') next.L = 'ㄴ';   // 음료 → 음뇨
    else if (KO_OBSTRUENT.has(cur.coda) && next.L === 'ㄹ') { next.L = 'ㄴ'; cur.coda = KO_NASALISE[cur.coda]; }   // 석류 → 성뉴
    if (KO_OBSTRUENT.has(cur.coda) && (next.L === 'ㄴ' || next.L === 'ㅁ')) cur.coda = KO_NASALISE[cur.coda];  // 국물 → 궁물
    if (KO_OBSTRUENT.has(cur.coda) && KO_LENIS[next.L]) next.tense = true;     // 학교 → 학꾜
  }
  return s;
}

// ── Devanagari rendering ──
const KO_DEV_VOWEL = {   // [independent, matra after consonant, glide]
  'ㅏ':['आ','ा',''], 'ㅐ':['ऐ','ै',''], 'ㅑ':['आ','ा','y'], 'ㅒ':['ऐ','ै','y'],
  'ㅓ':['ऑ','ॉ',''], 'ㅔ':['ए','े',''], 'ㅕ':['ऑ','ॉ','y'], 'ㅖ':['ए','े','y'],
  'ㅗ':['ओ','ो',''], 'ㅘ':['आ','ा','w'], 'ㅙ':['ऐ','ै','w'], 'ㅚ':['ए','े','w'],
  'ㅛ':['ओ','ो','y'], 'ㅜ':['ऊ','ू',''], 'ㅝ':['ऑ','ॉ','w'], 'ㅞ':['ए','े','w'],
  'ㅟ':['ई','ी','w'], 'ㅠ':['ऊ','ू','y'], 'ㅡ':['उ','ु',''], 'ㅢ':['उई','ुई',''], 'ㅣ':['ई','ी','']
};
const KO_DEV_ONSET = {   // [word-initial / after obstruent, voiced context]
  'ㄱ':['क','ग'], 'ㄷ':['त','द'], 'ㅂ':['प','ब'], 'ㅈ':['च','ज'],
  'ㅅ':['स','स'], 'ㅎ':['ह','ह'], 'ㄴ':['न','न'], 'ㅁ':['म','म'], 'ㄹ':['र','र'],
  'ㅋ':['ख','ख'], 'ㅌ':['थ','थ'], 'ㅍ':['फ','फ'], 'ㅊ':['छ','छ'],
  'ㄲ':['क','क'], 'ㄸ':['त','त'], 'ㅃ':['प','प'], 'ㅉ':['च','च'], 'ㅆ':['स','स']
};
const KO_DEV_CODA = { k:'क्', t:'त्', p:'प्', n:'न्', l:'ल्', m:'म्', ng:'ङ्' };
const KO_VELAR = new Set(['ㄱ','ㄲ','ㅋ']);   // ㅇ coda is written ं before these: 망고 → मांगो
const KO_SIBILANT_I = new Set(['ㅣ','ㅑ','ㅕ','ㅛ','ㅠ','ㅒ','ㅖ','ㅟ']);
const KO_PALATAL = new Set(['ㅈ','ㅉ','ㅊ']);

function koDevWord(word) {
  const s = koPhonology(word);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const syl = s[i], prev = s[i - 1];
    let [indep, matra, glide] = KO_DEV_VOWEL[syl.V];
    let onset = syl.L;
    if (onset === 'ㅇ') {
      // ㅇ coda before a vowel: write the ng sound as ङ carrying the vowel
      if (prev && prev.coda === 'ng') out += 'ङ' + (glide ? '्' + (glide === 'y' ? 'य' : 'व') : '') + matra;
      else out += (glide === 'y' ? 'य' + matra : glide === 'w' ? 'व' + matra : indep);
    } else {
      if (KO_PALATAL.has(onset) && glide === 'y') glide = '';            // 져 → 저
      if ((onset === 'ㅅ' || onset === 'ㅆ') && KO_SIBILANT_I.has(syl.V)) glide = glide === 'w' ? glide : '';
      if (syl.V === 'ㅢ') { matra = 'ी'; }                                // 희 → 히
      let cons;
      if (onset === 'ㄹ' && prev && prev.coda === 'l') cons = 'ल';         // ㄹㄹ → ल्ल
      else if ((onset === 'ㅅ' || onset === 'ㅆ') && KO_SIBILANT_I.has(syl.V)) cons = 'श';
      else {
        const voiced = prev && !(prev.coda && KO_OBSTRUENT.has(prev.coda)) && !syl.tense;
        cons = KO_DEV_ONSET[onset][voiced ? 1 : 0];
      }
      // Tense consonants after a vowel are written doubled: 토끼 → तोक्की
      const tenseJamo = 'ㄲㄸㅃㅉㅆ'.includes(onset);
      if (prev && !prev.coda && (tenseJamo || syl.tense)) cons = cons + '्' + cons;
      out += cons + (glide ? '्' + (glide === 'y' ? 'य' : 'व') : '') + matra;
    }
    const next = s[i + 1];
    if (syl.coda === 'ng') {
      // ㅇ coda: carried by ङ before a vowel, ं before a velar, ङ् elsewhere
      if (next && next.L === 'ㅇ') continue;
      out += next && KO_VELAR.has(next.L) ? 'ं' : 'ङ्';
    } else if (syl.coda) out += KO_DEV_CODA[syl.coda];
  }
  return out;
}

// ── Roman rendering (Revised Romanization) ──
const KO_ROM_ONSET = { 'ㄱ':'g','ㄲ':'kk','ㄴ':'n','ㄷ':'d','ㄸ':'tt','ㄹ':'r','ㅁ':'m','ㅂ':'b','ㅃ':'pp','ㅅ':'s','ㅆ':'ss','ㅇ':'','ㅈ':'j','ㅉ':'jj','ㅊ':'ch','ㅋ':'k','ㅌ':'t','ㅍ':'p','ㅎ':'h' };
const KO_ROM_VOWEL = { 'ㅏ':'a','ㅐ':'ae','ㅑ':'ya','ㅒ':'yae','ㅓ':'eo','ㅔ':'e','ㅕ':'yeo','ㅖ':'ye','ㅗ':'o','ㅘ':'wa','ㅙ':'wae','ㅚ':'oe','ㅛ':'yo','ㅜ':'u','ㅝ':'wo','ㅞ':'we','ㅟ':'wi','ㅠ':'yu','ㅡ':'eu','ㅢ':'ui','ㅣ':'i' };

function koRomanWord(word) {
  const s = koPhonology(word);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const syl = s[i], prev = s[i - 1];
    let onset = KO_ROM_ONSET[syl.L];
    if (syl.L === 'ㄹ' && prev && prev.coda === 'l') onset = 'l';         // ㄹㄹ → ll
    out += onset + KO_ROM_VOWEL[syl.V] + (syl.coda || '');
  }
  return out;
}

function koConvert(text, renderWord) {
  if (!text) return '';
  let out = '', word = '';
  for (const ch of text.normalize('NFC')) {
    if (isHangul(ch)) { word += ch; continue; }
    if (word) { out += renderWord(word); word = ''; }
    out += ch;
  }
  if (word) out += renderWord(word);
  return out;
}

export function toDev(text) { return koConvert(text, koDevWord); }
export function toRoman(text) { return koConvert(text, koRomanWord); }
export const toPronunciation = toDev;

// Each Hangul block is one syllable: 고양이 → ['고','양','이']
export function breakSyllables(word) {
  if (!word) return [];
  return [...word.normalize('NFC')].filter(ch => ch.trim());
}
