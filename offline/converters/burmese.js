// ═══ BURMESE TRANSLITERATION ENGINE ═══
// Single source of truth for Burmese → Devanagari conversion
// Uses longest-match-first algorithm
// R007: handles stacking mark ္ (U+1039), kinzi င်္, great-sa ဿ; tone marks no longer emit digits.
// R009: independent vowels ဥ ဦ ဣ ဤ ဧ ဩ ဪ, ဉ/ဉ်, ေါ forms, ုံ → ों, kinzi → िं, अ+vowel → independent vowel, final after a killed consonant → consonant+virama.
// R008: modern pronunciation — ရ → य, ြ medial = ျ (y), စ/ဆ → स, final nasals -န် -မ် -င် → nasalised vowel (ं),
//        ော် → ो, -က် after inherent a → ेक्, ိ before a stacked consonant → े.
//        Velar + ျ/ြ is palatalised: ကျ/ကြ → च, ချ/ခြ → छ, ဂျ/ဂြ → ज (ကျောင်း → चाउं).
// R011: sandhi (voicing) restored in toPronunciation — see sandhi() below. toDev stays letter-by-letter.
// R012: stop finals -က် -စ် -တ် -ပ် are a glottal stop, not a consonant: written as the vowel + ʼ (အနက်ရောင် → अनेʼयाउं).
//        A killed consonant before the next syllable used to join it (क्+या → क्या, "kyaung").

const CM = { // Consonant Map
  'က':'क','ခ':'ख','ဂ':'ग','ဃ':'घ','င':'ङ',
  'စ':'स','ဆ':'स','ဇ':'ज','ဈ':'झ','ည':'ञ',
  'ဋ':'ट','ဌ':'ठ','ဍ':'ड','ဎ':'ढ','ဏ':'ण',
  'တ':'त','ထ':'थ','ဒ':'द','ဓ':'ध','န':'न',
  'ပ':'प','ဖ':'फ','ဗ':'ब','ဘ':'भ','မ':'म',
  'ယ':'य','ရ':'य','လ':'ल','ဝ':'व','သ':'थ',
  'ဟ':'ह','ဠ':'ळ','အ':'अ','ဿ':'थ्थ','ဉ':'ञ',
  'ဣ':'इ','ဤ':'ई','ဥ':'उ','ဦ':'ऊ','ဦ':'ऊ','ဧ':'ए','ဩ':'ओ','ဪ':'औ'
};

const CC = { // Conjunct Clusters
  'ကျ':'च','ကြ':'च','ကွ':'क्व','ကျွ':'च्व',
  'ချ':'छ','ခြ':'छ','ခွ':'ख्व',
  'ဂျ':'ज','ဂြ':'ज','ဂွ':'ग्व',
  'စျ':'स्य','ဆွ':'स्व',
  'တျ':'त्य','တြ':'त्य','တွ':'त्व',
  'ထွ':'थ्व','ဒွ':'द्व',
  'ပျ':'प्य','ပြ':'प्य','ပွ':'प्व',
  'ဖျ':'फ्य','ဖြ':'फ्य',
  'ဗျ':'ब्य','ဗြ':'ब्य','ဗွ':'ब्व',
  'ဘျ':'भ्य','ဘွ':'भ्व',
  'မျ':'म्य','မြ':'म्य','မွ':'म्व',
  'လျ':'ल्य','လွ':'ल्व',
  'သျ':'थ्य','သြ':'थ्य','သွ':'थ्व',
  'ဟွ':'ह्व','ရွ':'य्व',
  'ကြွ':'च्व','ချွ':'छ्व','ပြွ':'प्य्व','မြွ':'म्य्व',
  // Medial ha ှ (stored after the consonant): voiceless / sh sounds
  'ရှ':'श','ယှ':'श','လျှ':'श','မှ':'ह्म','နှ':'ह्न','လှ':'ह्ल','ငှ':'ह्ङ','ညှ':'ह्ञ','ဝှ':'ह्व',
  'ှ':'ह',
  // Medial wa on any other consonant; ရွှ = shw
  'ရွှ':'श्व','ွ':'्व'
};

const VM = { // Vowel Map
  'ာ':'ा','ါ':'ा','ိ':'ि','ီ':'ी','ု':'ु','ူ':'ू',
  'ေ':'े','ဲ':'ै','ော':'ो','ို':'ो',
  'ံ':'ं','်':'्',
  'ွန်':'ुं','ွတ်':'ुʼ','ွပ':'ुप','ွက်':'ुʼ',
  'ိုက်':'ाइʼ','ည်':'ी','ည့်':'ी','စ်':'िʼ','ောက်':'ाउʼ',
  // Final nasals = nasalised vowel, not a consonant
  'န်':'ं','မ်':'ं','ိန်':'ें','ိမ်':'ें','ုန်':'ों','ုမ်':'ों','င်':'िं','ောင်':'ाउं','ိုင်':'ाइं',
  // ော + asat (လိမ္မော်) is just the vowel ो
  'ော်':'ो',
  // ေ + tall ါ behaves like ော
  'ေါ':'ो','ေါ်':'ो','ေါက်':'ाउʼ','ေါင်':'ाउं',
  'ုံ':'ों',
  // ဉ် (and ဥ် typed in its place) is the final -in (ချဉ် → छिं)
  'ဉ်':'िं','ဥ်':'िं','ာဉ်':'िं',
  // Final -ယ် is the open vowel /ɛ/ (ဘယ် → भै); ိတ်/ိပ် = /eɪʔ/, ုတ်/ုပ် = /oʊʔ/; -တ်/-ပ် after inherent a = /aʔ/, ာတ် too (ဓာတ်)
  'ယ်':'ै','ိတ်':'ेʼ','ိပ်':'ेʼ','ုတ်':'ोʼ','ုပ်':'ोʼ','တ်':'ʼ','ပ်':'ʼ','ာတ်':'ाʼ',
  // Creaky-tone finals (dot below sits before asat after NFC): same vowel as the plain final
  'န့်':'ं','မ့်':'ं','င့်':'िं','ုန့်':'ों','ိန့်':'ें','ောင့်':'ाउं','ိုင့်':'ाइं',
  // Punctuation
  '။':'','၊':'',
  // Glottal-stop finals: -က် after inherent a is /ɛʔ/ (အနက် → अनेʼ); ိက် /eɪʔ/, ုက် /oʊʔ/
  'က်':'ेʼ','ိက်':'ेʼ','ုက်':'ोʼ',
  // ိ before a stacked consonant is /eɪ/ → े (လိမ္မော် → लेम्मो)
  'ိက္':'ेक्','ိစ္':'ेस्','ိတ္':'ेत्','ိဒ္':'ेद्','ိန္':'ेन्','ိပ္':'ेप्','ိမ္':'ेम्',
  // Stacking
  'င်္':'िं',   // kinzi — nasal carried onto the next (stacked) consonant
  '္':'्',     // stacking mark — lower consonant joins as a conjunct
  // Tone marks — no Devanagari equivalent; drop instead of emitting digits
  'း':'','့':''
};

const DIGITS = { '၀':'०','၁':'१','၂':'२','၃':'३','၄':'४','၅':'५','၆':'६','၇':'७','၈':'८','၉':'९' };

const OVR = { // Common overrides (colloquial voicing)
  'မြန်မာ':'म्यन्मा','ပါ':'बा','တယ်':'दे','လဲ':'ले',
  'ပြီ':'प्यी','ဘူး':'बू','လား':'ला',
  'ဒယ်':'दे',   // voiced တယ် (after sandhi) keeps the same colloquial vowel
  'ကောင်း':'काउं','ဟုတ်':'होʼ','ရောက်':'याउʼ',
  'ချင်':'छिं','သွား':'थ्वा','စား':'सा'
};

// Build sorted key list (longest first) for each map
const allKeys = {};
for (const map of [OVR, CC, VM, CM, DIGITS]) {
  for (const k of Object.keys(map)) {
    allKeys[k] = map[k];
  }
}
const sortedKeys = Object.keys(allKeys).sort((a, b) => b.length - a.length);

export function toDev(burmese) {
  if (!burmese) return '';
  let result = '';
  let i = 0;
  const text = burmese.normalize('NFC').trim();

  while (i < text.length) {
    let matched = false;
    for (const key of sortedKeys) {
      if (text.startsWith(key, i)) {
        let out = allKeys[key];
        // A final right after another final (ကပ်စ်) or an explicit vowel (ဆော့စ်) is a loanword consonant, killed
        if (key.length === 2 && key[1] === '်' && CM[key[0]] && /[्ािीुूेैोौʼ]$/.test(result)) out = CM[key[0]] + '्';
        result += out;
        i += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result += text[i];
      i++;
    }
  }
  // Collapse virama doubled by asat + stacking (e.g. ်္)
  return result
    .replace(/््+/g, '्')
    .replace(/अ([ािीुूेैोौ])/g, (m, v) => ({'ा':'आ','ि':'इ','ी':'ई','ु':'उ','ू':'ऊ','े':'ए','ै':'ऐ','ो':'ओ','ौ':'औ'})[v])
    .replace(/्(?=[ािीुूेैोौ])/g, '');
}

// Syllable breakdown - splits a Burmese word into syllable components
export function breakSyllables(word) {
  if (!word) return [];
  const syllables = [];
  let current = '';

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const code = ch.charCodeAt(0);

    // Myanmar consonant range: U+1000 - U+1021 (+ ဿ U+103F)
    if (((code >= 0x1000 && code <= 0x1021) || code === 0x103F) && current.length > 0) {
      // A consonant followed by asat (်) or stacking mark (္) closes the previous syllable;
      // a consonant after ္ is the stacked lower half and stays in the cluster.
      const next = word[i + 1];
      if (next !== '်' && next !== '္' && !current.endsWith('္')) {
        syllables.push(current);
        current = ch;
        continue;
      }
    }
    current += ch;
  }
  if (current) syllables.push(current);
  return syllables;
}

// ═══ SANDHI (voicing) ═══
// Inside a word, a syllable's voiceless initial becomes voiced when the syllable before it
// ends in a vowel or nasal: ပင်ပန်းတယ် → ပင်ဗန်းဒယ် → पिंबंदे, ဒါ လုံချည်ပါ → … जीबा.
// Not voiced: the first syllable of a word, after a glottal-stop final (-က် -စ် -တ် -ပ်),
// after the prefixes မ (negation) / အ, or when the consonant carries medial ha (ှ).
// Words are space-separated chunks; voicing never crosses a space.
const VOICE = { 'က':'ဂ','ခ':'ဂ','စ':'ဇ','ဆ':'ဇ','တ':'ဒ','ထ':'ဒ','ပ':'ဗ','ဖ':'ဗ','သ':'ဒ' };
const STOP_FINAL = /[ကစတပ]့?်[့း]*$/;
const NO_VOICE_AFTER = new Set(['မ', 'အ']);
const NO_SANDHI = new Set([]);   // whole words that must stay unvoiced (add as found)
const isCons = ch => { const c = ch.charCodeAt(0); return (c >= 0x1000 && c <= 0x1021) || c === 0x103F; };

// Like breakSyllables, but keeps creaky finals (န့် — dot below before asat) inside their syllable.
function sylls(w) {
  const out = []; let cur = '';
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (isCons(ch) && cur) {
      let j = i + 1; while (w[j] === '့') j++;
      if (w[j] !== '်' && w[j] !== '္' && !cur.endsWith('္')) { out.push(cur); cur = ch; continue; }
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function sandhi(burmese) {
  if (!burmese) return '';
  return burmese.normalize('NFC').split(/(\s+)/).map(word => {
    if (!word.trim() || NO_SANDHI.has(word)) return word;
    const s = sylls(word);
    for (let i = 1; i < s.length; i++) {
      const v = VOICE[s[i][0]], prev = s[i - 1];
      if (!v || /^.[ျြွ]*ှ/.test(s[i]) || STOP_FINAL.test(prev) || NO_VOICE_AFTER.has(prev)) continue;
      s[i] = v + s[i].slice(1);
    }
    return s.join('');
  }).join('');
}

// What the app shows on the pronunciation line: spoken form, with voicing.
// Pass { sandhi: false } for the literal letter-by-letter reading (same as toDev).
export function toPronunciation(burmese, opts = {}) {
  return toDev(opts.sandhi === false ? burmese : sandhi(burmese));
}
