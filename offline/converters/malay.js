// ═══ MALAY (Bahasa Melayu, Rumi script) → DEVANAGARI ENGINE ═══
// Malay is already written in Latin letters, so Devanagari here is a pronunciation
// guide for Hindi/Marathi readers, not a script conversion.
//
// Rules
//   • Syllables: V | CV | CVC. Between vowels: 1 consonant → next onset; 2 → split;
//     3+ → last two go to the onset if they form pr/tr/kl/st… else only the last one.
//   • a: open syllable → ा (makan → माकन), closed → inherent अ.
//   • e: Malay spelling does not tell schwa (e pepet: besar) from é (e taling: merah).
//     Default = schwa (inherent अ). Words with é are listed in E_TALING below.
//   • i/u word-final open → ी/ू (biru → बिरू). Vowel after i/é → य glide (dia → दिया),
//     after u/o → व glide (buah → बुवाह).
//   • ng: word-initial → ङ, between vowels → ंग (bunga → बुंगा), before a consonant
//     or word-final → ं / ंग (mangga → मंगा, kucing → कुचिंग). ny → न्य, sy → श,
//     kh → ख़, gh → ग़, c → च, f → फ़, z → ज़, v/w → व.
//   • Nasal n/m before another consonant → anusvara (lampu → लंपू, pintu → पिंतू).
//   • Word-final diphthongs ai → ै, au → ौ, oi → ॉय (sungai, pulau, amboi).
//   • Word-final -k is a glottal stop in speech (tidak, budak). PENDING native-speaker
//     decision — switch FINAL_K_MODE below: 'halant' (क्) | 'plain' (क) | 'drop'.
// Exports: toDev(text), toRoman(text), breakSyllables(word)

const FINAL_K_MODE = 'halant';

const CONS = {
  b: 'ब', c: 'च', d: 'द', f: 'फ़', g: 'ग', h: 'ह', j: 'ज', k: 'क', l: 'ल', m: 'म',
  n: 'न', p: 'प', q: 'क़', r: 'र', s: 'स', t: 'त', v: 'व', w: 'व', x: 'क्स', y: 'य',
  z: 'ज़', ng: 'ङ', ny: 'न्य', sy: 'श', kh: 'ख़', gh: 'ग़',
};
const DIGRAPHS = ['ng', 'ny', 'sy', 'kh', 'gh'];
const VOWELS = new Set(['a', 'e', 'é', 'i', 'o', 'u']);
const FINAL_DIPHTHONGS = new Set(['ai', 'au', 'oi']);
// [open syllable, closed syllable]
const INDEP = { a: ['आ', 'अ'], e: ['अ', 'अ'], 'é': ['ए', 'ए'], i: ['इ', 'इ'], o: ['ओ', 'ओ'], u: ['उ', 'उ'], ai: ['ऐ', 'ऐ'], au: ['औ', 'औ'], oi: ['ऑय', 'ऑय'] };
const MATRA = { a: ['ा', ''], e: ['', ''], 'é': ['े', 'े'], i: ['ि', 'ि'], o: ['ो', 'ो'], u: ['ु', 'ु'], ai: ['ै', 'ै'], au: ['ौ', 'ौ'], oi: ['ॉय', 'ॉय'] };
const ONSET_CLUSTERS = new Set(['pr', 'br', 'tr', 'dr', 'kr', 'gr', 'fr', 'pl', 'bl', 'kl', 'gl', 'fl', 'sl', 'sp', 'st', 'sk', 'sm', 'sn', 'sw']);
const NASALS = new Set(['n', 'm', 'ng']);
const Y_GLIDE = new Set(['i', 'é', 'ai']);
const W_GLIDE = new Set(['u', 'o', 'au']);

// Words containing e taling (é). Respell with é; every other e is read as schwa.
// Native-speaker review (phase M5) extends this list.
const E_TALING = {
  merah: 'mérah', leher: 'léhér', esok: 'ésok', belok: 'bélok', selekoh: 'selékoh',
  teh: 'téh', nenek: 'nénék', keju: 'kéju', sosej: 'soséj', epal: 'épal', lemon: 'lémon',
  ceri: 'céri', mentega: 'mentéga', jem: 'jém', tenis: 'ténis', helikopter: 'hélikoptér',
  teksi: 'téksi', trem: 'trém', kereta: 'keréta', oren: 'orén', monyet: 'monyét',
  februari: 'fébruari', september: 'séptémber', oktober: 'oktobér', november: 'novémber',
  besbol: 'bésbol', sepak: 'sépak', meja: 'méja', enak: 'énak', sate: 'saté',
  mineral: 'minéral', goreng: 'goréng', boleh: 'boléh', bendi: 'béndi',
};
// Whole-word overrides (loanwords read the English way, irregular spellings)
const OVERRIDES = {
  mei: 'मेई', wifi: 'वाइफ़ाइ', strawberi: 'स्ट्रॉबेरी', burger: 'बर्गर', piano: 'पियानो',
  mayonis: 'मेयोनिस', yogurt: 'योगर्ट', badminton: 'बैडमिंटन', ping: 'पिंग', pong: 'पॉंग',
  sandwic: 'सैंडविच',
};

function tokenize(w) {
  const u = [];
  let i = 0;
  while (i < w.length) {
    const two = w.slice(i, i + 2);
    const ch = w[i];
    if (VOWELS.has(ch)) {
      if (FINAL_DIPHTHONGS.has(two) && i + 2 === w.length && i > 0) { u.push({ v: two, s: two }); i += 2; continue; }
      u.push({ v: ch, s: ch }); i++; continue;
    }
    if (DIGRAPHS.includes(two)) { u.push({ c: two, s: two }); i += 2; continue; }
    u.push({ c: ch, s: ch }); i++;
  }
  return u;
}

function syllabify(u) {
  const vIdx = [];
  u.forEach((x, i) => { if (x.v) vIdx.push(i); });
  if (!vIdx.length) return [{ on: u, nu: null, co: [] }];
  const out = [];
  let start = 0;
  vIdx.forEach((vi, k) => {
    const next = vIdx[k + 1];
    let co, end;
    if (next === undefined) { co = u.slice(vi + 1); end = u.length; }
    else {
      const mid = u.slice(vi + 1, next);
      const n = mid.length;
      let take = 0;
      if (n === 2) take = 1;
      else if (n >= 3) take = ONSET_CLUSTERS.has(mid.slice(-2).map(x => x.s).join('')) ? n - 2 : n - 1;
      co = mid.slice(0, take); end = vi + 1 + take;
    }
    out.push({ on: u.slice(start, vi), nu: u[vi], co });
    start = end;
  });
  return out;
}

const dev = c => CONS[c] || c;

function renderWord(raw) {
  let w = raw.toLowerCase().normalize('NFC').replace(/ê/g, 'e');
  if (OVERRIDES[w]) return OVERRIDES[w];
  if (E_TALING[w]) w = E_TALING[w];
  const syl = syllabify(tokenize(w));
  let out = '';
  syl.forEach((s, k) => {
    const last = k === syl.length - 1;
    const prev = syl[k - 1];
    let on = s.on.map(x => x.c);
    if (!s.nu) { out += on.map(dev).join('्'); return; }
    // vowel after vowel → glide
    if (k > 0 && !on.length && !prev.co.length) {
      if (Y_GLIDE.has(prev.nu?.v)) on = ['y'];
      else if (W_GLIDE.has(prev.nu?.v)) on = ['w'];
    }
    // ng between vowels → anusvara on the previous syllable + ग
    if (k > 0 && on[0] === 'ng') { out += 'ं'; on = ['g', ...on.slice(1)]; }
    const v = s.nu.v;
    const closed = s.co.length > 0;
    let piece;
    if (!on.length) {
      piece = INDEP[v][closed ? 1 : 0];
      if (last && !closed && v === 'i') piece = 'ई';
      if (last && !closed && v === 'u') piece = 'ऊ';
    } else {
      let m = MATRA[v][closed ? 1 : 0];
      if (last && !closed && v === 'i') m = 'ी';
      if (last && !closed && v === 'u') m = 'ू';
      piece = on.map(dev).join('्') + m;
    }
    const co = s.co.map(x => x.c);
    co.forEach((c, j) => {
      const lastC = j === co.length - 1;
      if (!last) piece += NASALS.has(c) && lastC ? 'ं' : dev(c) + '्';
      else if (!lastC) piece += dev(c) + '्';
      else if (c === 'ng') piece += 'ंग';
      else if (c === 'k') piece += FINAL_K_MODE === 'drop' ? '' : FINAL_K_MODE === 'plain' ? 'क' : 'क्';
      else piece += dev(c);
    });
    out += piece;
  });
  return out;
}

const WORD_RE = /[A-Za-zÀ-ɏ]+/g;

export function toDev(text) {
  if (!text) return '';
  return text.normalize('NFC').replace(WORD_RE, renderWord);
}

// Malay is already Roman script
export function toRoman(text) { return text || ''; }
export const toPronunciation = toDev;

// ma·kan, ba·ngu·nan, nya·nyi — keeps the learner's original spelling and case
export function breakSyllables(word) {
  if (!word) return [];
  const src = word.normalize('NFC');
  const res = [];
  let pos = 0;
  src.replace(WORD_RE, (m, offset) => {
    if (offset > pos) res.push(src.slice(pos, offset));
    let w = m.toLowerCase();
    if (E_TALING[w]) w = E_TALING[w];
    let p = offset;
    syllabify(tokenize(w)).forEach(s => {
      const len = [...s.on, ...(s.nu ? [s.nu] : []), ...s.co].reduce((n, x) => n + x.s.length, 0);
      res.push(src.slice(p, p + len)); p += len;
    });
    pos = offset + m.length;
    return m;
  });
  if (pos < src.length) res.push(src.slice(pos));
  return res.filter(x => x.trim());
}
