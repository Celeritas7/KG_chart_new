// ═══ THAI TRANSLITERATION ENGINE ═══
// Thai → Devanagari / Roman for pronunciation hints.
// Thai spelling does not show every vowel or syllable break, so the engine:
//   • reads written vowels around the consonant: before (เ แ โ ใ ไ), above, below and after
//   • fills in unwritten vowels:  ผม → phom,  สบาย → sa-bai,  ขนม → kha-nom
//   • handles clusters (ปลา → pla), silent ห and อ (หมา → ma, อยู่ → yu),
//     silent letters under ์ (สัตว์ → sat) and final-consonant sounds (อาหาร → ahan)
//   • uses TH_SPOKEN for words whose spelling and sound disagree (ผลไม้ → phonlamai)
// Roman follows the Royal Thai General System (RTGS): no tones, no vowel length.
// Devanagari keeps vowel length (ा ी ू) and aspiration (ख थ फ छ); อ → ॉ, แ → ै.
// Exports: toDev(text), toRoman(text), breakSyllables(word)

const TH_CONS = 'กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ';
const TH_LEAD = 'เแโใไ';
const TH_TONES = '่้๊๋';
const TH_VOWELISH = 'ัิีึืุู็่้๊๋ะาำ';
const TH_SONORANT = 'งญนมยรลว';
const TH_SILENT = '์';
const TH_REPEAT = 'ๆ';
const TH_RU = 'ฤ';

// Initial sound: [Roman, Devanagari]
const TH_INIT = {
  'ก':['k','क'], 'ข':['kh','ख'], 'ฃ':['kh','ख'], 'ค':['kh','ख'], 'ฅ':['kh','ख'], 'ฆ':['kh','ख'], 'ง':['ng','ङ'],
  'จ':['ch','च'], 'ฉ':['ch','छ'], 'ช':['ch','छ'], 'ซ':['s','स'], 'ฌ':['ch','छ'], 'ญ':['y','य'],
  'ฎ':['d','द'], 'ฏ':['t','त'], 'ฐ':['th','थ'], 'ฑ':['th','थ'], 'ฒ':['th','थ'], 'ณ':['n','न'],
  'ด':['d','द'], 'ต':['t','त'], 'ถ':['th','थ'], 'ท':['th','थ'], 'ธ':['th','थ'], 'น':['n','न'],
  'บ':['b','ब'], 'ป':['p','प'], 'ผ':['ph','फ'], 'ฝ':['f','फ़'], 'พ':['ph','फ'], 'ฟ':['f','फ़'], 'ภ':['ph','फ'],
  'ม':['m','म'], 'ย':['y','य'], 'ร':['r','र'], 'ล':['l','ल'], 'ว':['w','व'],
  'ศ':['s','स'], 'ษ':['s','स'], 'ส':['s','स'], 'ห':['h','ह'], 'ฬ':['l','ल'], 'อ':['',''], 'ฮ':['h','ह']
};
// Final consonant sound class
const TH_FINAL = {};
for (const c of 'กขฃคฅฆ') TH_FINAL[c] = 'k';
for (const c of 'จฉชซฌดตถทธฎฏฐฑฒศษส') TH_FINAL[c] = 't';
for (const c of 'บปผพฟภ') TH_FINAL[c] = 'p';
for (const c of 'นณญรลฬ') TH_FINAL[c] = 'n';
TH_FINAL['ม'] = 'm'; TH_FINAL['ง'] = 'ng'; TH_FINAL['ว'] = 'w'; TH_FINAL['ย'] = 'y';

// True clusters: second letter is pronounced. [Roman, Devanagari]
const TH_CLUSTER = {
  'กร':['kr','क्र'], 'กล':['kl','क्ल'], 'กว':['kw','क्व'], 'ขร':['khr','ख्र'], 'ขล':['khl','ख्ल'], 'ขว':['khw','ख्व'],
  'คร':['khr','ख्र'], 'คล':['khl','ख्ल'], 'คว':['khw','ख्व'], 'ตร':['tr','त्र'], 'ปร':['pr','प्र'], 'ปล':['pl','प्ल'],
  'ผล':['phl','फ्ल'], 'พร':['phr','फ्र'], 'พล':['phl','फ्ल'],
  // loanword clusters
  'บร':['br','ब्र'], 'บล':['bl','ब्ल'], 'ฟร':['fr','फ़्र'], 'ฟล':['fl','फ़्ल']
};
// False clusters: ทร sounds ซ; ร is silent after จ ซ ศ ส
const TH_FALSE_CLUSTER = { 'ทร':['s','स'], 'จร':['ch','च'], 'ซร':['s','स'], 'ศร':['s','स'], 'สร':['s','स'] };

// Words whose sound does not follow their spelling, respelled phonetically. '|' marks a syllable break.
const TH_SPOKEN = {
  'ผลไม้':'ผน|ละ|ไม้', 'ภรรยา':'พัน|ระ|ยา', 'จันทร์':'จัน', 'พฤหัสบดี':'พะ|รึ|หัด|สะ|บอ|ดี',
  'บริการ':'บอ|ริ|กาน', 'จักรยาน':'จัก|กระ|ยาน', 'แครอท':'แค|รอด',
  'มกราคม':'มก|กะ|รา|คม', 'กุมภาพันธ์':'กุม|พา|พัน', 'พฤษภาคม':'พรึด|สะ|พา|คม',
  'กรกฎาคม':'กะ|ระ|กะ|ดา|คม', 'พฤศจิกายน':'พรึด|สะ|จิ|กา|ยน', 'ก็':'ก้อ',
  'ชมพู':'ชม|พู', 'อดิเรก':'อะ|ดิ|เรก'
};
const TH_SPOKEN_KEYS = Object.keys(TH_SPOKEN).sort((a, b) => b.length - a.length);
// How those words split into written syllables (tiles for word-building games)
const TH_PARTS = {
  'ผลไม้':['ผล','ไม้'], 'ภรรยา':['ภรร','ยา'], 'จันทร์':['จันทร์'], 'พฤหัสบดี':['พฤ','หัส','บดี'],
  'บริการ':['บริ','การ'], 'จักรยาน':['จักร','ยาน'], 'แครอท':['แค','รอท'],
  'มกราคม':['มก','รา','คม'], 'กุมภาพันธ์':['กุม','ภา','พันธ์'], 'พฤษภาคม':['พฤษ','ภา','คม'],
  'กรกฎาคม':['กร','กฎา','คม'], 'พฤศจิกายน':['พฤศ','จิ','กา','ยน'], 'ก็':['ก็'],
  'ชมพู':['ชม','พู'], 'อดิเรก':['อ','ดิ','เรก']
};

// Vowels. Roman, and Devanagari as [vowel sign, trailing letters when closed, trailing letters when open]
const TH_VOWEL = {
  a:['a','','',''], aa:['a','ा','',''], i:['i','ि','',''], ii:['i','ी','',''],
  ue:['ue','ु','',''], uue:['ue','ू','',''], u:['u','ु','',''], uu:['u','ू','',''],
  e:['e','े','',''], ae:['ae','ै','',''], o:['o','ो','',''], or:['o','ॉ','',''],
  oe:['oe','','','अ'], ia:['ia','ी','य','या'], uea:['uea','ु','अ','आ'], ua:['ua','ु','अ','आ']
};
const TH_INDEP = { '':'अ', 'ा':'आ', 'ि':'इ', 'ी':'ई', 'ु':'उ', 'ू':'ऊ', 'े':'ए', 'ै':'ऐ', 'ो':'ओ', 'ॉ':'ऑ' };
const TH_FINAL_ROM = { k:'k', t:'t', p:'p', n:'n', m:'m', ng:'ng', w:'o', y:'i' };
const TH_FINAL_DEV = { k:'क्', t:'त्', p:'प्', n:'न्', m:'म्', ng:'ङ्', w:'उ', y:'इ' };

const isThaiCons = (ch) => !!ch && TH_CONS.includes(ch);
const isThai = (ch) => { if (!ch) return false; const c = ch.codePointAt(0); return c >= 0x0E00 && c <= 0x0E7F; };

function thNextNonTone(s, k) { while (k < s.length && TH_TONES.includes(s[k])) k++; return k; }

// Cluster or silent-letter pair starting at j: { len, rom, dev } or null
function thPairAt(s, j, lead) {
  const c1 = s[j], c2 = s[j + 1], c3 = s[j + 2];
  if (!isThaiCons(c1) || !isThaiCons(c2) || c3 === TH_SILENT) return null;
  const after = s[thNextNonTone(s, j + 2)];
  const hasMore = c3 !== undefined && c3 !== '|' && isThai(c3);
  if (c1 === 'ห' && TH_SONORANT.includes(c2) && (hasMore || lead)) return { len: 2, rom: TH_INIT[c2][0], dev: TH_INIT[c2][1] };   // หมา → ma
  if (c1 === 'อ' && c2 === 'ย' && c3 && TH_VOWELISH.includes(c3)) return { len: 2, rom: 'y', dev: 'य' };                       // อยู่ → yu
  const cl = TH_CLUSTER[c1 + c2], fc = TH_FALSE_CLUSTER[c1 + c2];
  if (!cl && !fc) return null;
  if (c2 === 'ว') { if (!(c3 && TH_VOWELISH.includes(c3))) return null; }        // ควร → khuan, but ขวา → khwa
  else if (lead) {
    if ('โใไแ'.includes(lead) && after && 'าัิีึืุูำ'.includes(after)) return null;   // โคล่า → kho-la
    if (lead === 'เ' && after && 'ัุูำ'.includes(after)) return null;
  } else if (!hasMore) return null;                                                // พร at word end → phon
  if (fc && !(c3 && (TH_VOWELISH.includes(c3) || lead))) return null;
  const [rom, dev] = cl || fc;
  return { len: 2, rom, dev };
}

// Does the consonant at j start a syllable (rather than close the previous one)?
const thVowelish = (ch) => !!ch && TH_VOWELISH.includes(ch);

// Is the อ at k the start of a syllable (อ่าน, ออก, อย่าง) rather than the vowel of the consonant before it?
function thOStarts(s, k) {
  const n1 = s[k + 1], n2 = s[k + 2];
  if (thVowelish(n1)) return true;                       // การ|อ่าน
  if (n1 === 'อ' && !thVowelish(n2)) return true;         // ตะวัน|ออก
  if (n1 === 'ย' && thVowelish(n2)) return true;          // เป็น|อย่าง
  return false;                                         // พอ, ของ, ขอ|อัน
}

function thStartsSyllable(s, j) {
  const c = s[j];
  if (c === TH_RU || c === 'อ') return true;            // อ never closes a syllable
  if (!isThaiCons(c)) return false;
  const n1 = s[j + 1];
  if (thVowelish(n1)) return true;
  if (n1 === 'อ' && !thOStarts(s, j + 1)) return true;   // อ is this consonant's vowel: พอ, ของ
  if (n1 === 'ว' && isThaiCons(s[j + 2]) && !thStartsSyllable(s, j + 2)) return true;   // ว is this consonant's vowel: สวย, ควร
  if (thPairAt(s, j, null)) {
    const n3 = s[j + 2];
    if (n3 && (TH_VOWELISH.includes(n3) || n3 === 'อ' || isThaiCons(n3))) return true;
  }
  return false;
}

function thInitial(s, i, lead) {
  if (s[i] === TH_RU) return { len: 1, rom: 'r', dev: 'र', ru: true };
  const pair = thPairAt(s, i, lead);
  if (pair) return pair;
  const t = TH_INIT[s[i]];
  return t ? { len: 1, rom: t[0], dev: t[1] } : null;
}

// Written vowel after the initial. Returns { v, f, i, final } or null when no vowel is written.
function thNucleus(s, i, lead) {
  const k = thNextNonTone(s, i), c = s[k];
  if (!lead) {
    if (c === 'ั') {
      const k2 = thNextNonTone(s, k + 1), c2 = s[k2];
      if (c2 === 'ว' && !thStartsSyllable(s, k2)) return { v: 'ua', i: s[k2 + 1] === 'ะ' ? k2 + 2 : k2 + 1, final: false };
      if (c2 === 'ย' && !thStartsSyllable(s, k2)) return { v: 'a', f: 'y', i: k2 + 1, final: false };
      return { v: 'a', i: k + 1, final: true };
    }
    if (c === 'ำ') return { v: 'a', f: 'm', i: k + 1, final: false };
    if (c === 'ะ') return { v: 'a', i: k + 1, final: false };
    if (c === 'า') return { v: 'aa', i: k + 1, final: true };
    if (c === 'ิ') return { v: 'i', i: k + 1, final: true };
    if (c === 'ี') return { v: 'ii', i: k + 1, final: true };
    if (c === 'ึ') return { v: 'ue', i: k + 1, final: true };
    if (c === 'ื') { const k2 = thNextNonTone(s, k + 1); return { v: 'uue', i: s[k2] === 'อ' ? k2 + 1 : k + 1, final: true }; }
    if (c === 'ุ') return { v: 'u', i: k + 1, final: true };
    if (c === 'ู') return { v: 'uu', i: k + 1, final: true };
    if (c === '็') return { v: 'or', i: k + 1, final: false };
    if (c === 'อ' && !thOStarts(s, k)) return { v: 'or', i: k + 1, final: true };
    if (c === 'ว' && isThaiCons(s[k + 1]) && !thStartsSyllable(s, k + 1)) return { v: 'ua', i: k + 1, final: true };   // สวน, สวย
    return null;
  }
  if (lead === 'เ') {
    if (c === 'ี') { const k2 = thNextNonTone(s, k + 1); if (s[k2] === 'ย') return s[k2 + 1] === 'ะ' ? { v: 'ia', i: k2 + 2, final: false } : { v: 'ia', i: k2 + 1, final: true }; }
    if (c === 'ื') { const k2 = thNextNonTone(s, k + 1); if (s[k2] === 'อ') return s[k2 + 1] === 'ะ' ? { v: 'uea', i: k2 + 2, final: false } : { v: 'uea', i: k2 + 1, final: true }; }
    if (c === 'า') return s[k + 1] === 'ะ' ? { v: 'or', i: k + 2, final: false } : { v: 'a', f: 'w', i: k + 1, final: false };
    if (c === 'อ') return s[k + 1] === 'ะ' ? { v: 'oe', i: k + 2, final: false } : { v: 'oe', i: k + 1, final: false };
    if (c === 'ิ') return { v: 'oe', i: k + 1, final: true };
    if (c === '็') return { v: 'e', i: k + 1, final: true };
    if (c === 'ะ') return { v: 'e', i: k + 1, final: false };
    if (c === 'ย' && !thStartsSyllable(s, k)) return { v: 'oe', f: 'y', i: k + 1, final: false };
    return { v: 'e', i: k, final: true };
  }
  if (lead === 'แ') {
    if (c === 'ะ') return { v: 'ae', i: k + 1, final: false };
    if (c === '็') return { v: 'ae', i: k + 1, final: true };
    return { v: 'ae', i: k, final: true };
  }
  if (lead === 'โ') return c === 'ะ' ? { v: 'o', i: k + 1, final: false } : { v: 'o', i: k, final: true };
  // ใ ไ: short a + i; ไทย keeps a silent ย
  const silentY = lead === 'ไ' && s[k] === 'ย' && !thStartsSyllable(s, k);
  return { v: 'a', f: 'y', i: silentY ? k + 1 : k, final: false };
}

// Parse a Thai run into syllables: { rom, dev, v, f, start, end }
function thParse(s) {
  const out = [];
  let i = 0;
  const push = (init, v, f, start, end) => out.push({ init, v, f, start, end });
  while (i < s.length) {
    const ch = s[i];
    if (ch === '|') { i++; continue; }
    if (ch === TH_REPEAT) { if (out.length) out.push({ ...out[out.length - 1], start: i, end: i + 1 }); i++; continue; }
    const start = i;
    const lead = TH_LEAD.includes(ch) ? ch : null;
    if (lead) i++;
    const init = (isThaiCons(s[i]) || s[i] === TH_RU) ? thInitial(s, i, lead) : null;
    if (!init) { out.push({ raw: s.slice(start, i + 1), start, end: i + 1 }); i = start + (lead ? 2 : 1); continue; }
    i += init.len;
    if (init.ru) { i = thNextNonTone(s, i); push(init, 'ue', null, start, i); continue; }   // ฤดู → ruedu
    const nuc = thNucleus(s, i, lead);
    if (nuc) {
      i = nuc.i;
      let f = nuc.f || null;
      if (nuc.final) {
        // A consonant after the vowel closes it, unless it begins an even run of bare
        // consonants that ends the word: มีนา|คม, not มีนาค|ม
        const k = thNextNonTone(s, i);
        let e = k;
        while (isThaiCons(s[e]) && !thStartsSyllable(s, e)) e++;
        const runLen = e - k, endsWord = !(isThaiCons(s[e]) || TH_LEAD.includes(s[e]) || s[e] === TH_RU);
        if (runLen > 0 && !(runLen % 2 === 0 && endsWord)) { f = TH_FINAL[s[k]]; i = k + 1; }
        else i = k;
      }
      push(init, nuc.v, f, start, i);
      continue;
    }
    // No written vowel: collect the run of bare consonants and supply the vowels.
    // 1 → Ca, 2 → CoC, 3 → Ca + CoC, 4 → CoC + CoC …   (สบาย, ผม, ขนม, รถยนต์)
    const units = [{ init, start }];
    let j = thNextNonTone(s, i);
    while (j < s.length && isThaiCons(s[j]) && !thStartsSyllable(s, j)) { units.push({ cons: s[j], start: j }); j++; }
    let u = 0;
    if (units.length % 2 === 1) { push(units[0].init, 'a', null, units[0].start, units[1] ? units[1].start : j); u = 1; }
    for (; u < units.length; u += 2) {
      const a = units[u], b = units[u + 1];
      const ini = a.init || { rom: TH_INIT[a.cons][0], dev: TH_INIT[a.cons][1] };
      push(ini, 'o', TH_FINAL[b.cons], a.start, units[u + 2] ? units[u + 2].start : j);
    }
    i = j;
  }
  return out;
}

// Remove letters silenced by ์ (and a vowel sign under them), keeping a map back to the original text.
function thStripSilent(text) {
  let s = '', map = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (isThaiCons(ch) && (text[i + 1] === TH_SILENT || ('ิุ'.includes(text[i + 1]) && text[i + 2] === TH_SILENT))) {
      i += text[i + 1] === TH_SILENT ? 1 : 2;
      continue;
    }
    if (ch === TH_SILENT) continue;
    s += ch; map.push(i);
  }
  map.push(text.length);
  return { s, map };
}

function thRespell(text) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const key = TH_SPOKEN_KEYS.find(k => text.startsWith(k, i));
    if (key) { out += '|' + TH_SPOKEN[key] + '|'; i += key.length; }
    else { out += text[i]; i++; }
  }
  return out;
}

function thRenderRoman(syl) {
  if (syl.raw) return syl.raw;
  return syl.init.rom + TH_VOWEL[syl.v][0] + (syl.f ? TH_FINAL_ROM[syl.f] : '');
}

function thRenderDev(syl, next, isLast) {
  if (syl.raw) return syl.raw;
  const [, sign, closedTail, openTail] = TH_VOWEL[syl.v];
  const closed = !!syl.f;
  let tail = closed ? closedTail : openTail;
  if (syl.v === 'oe' && (syl.f === 'w' || syl.f === 'y')) tail = 'अ';          // เนย → नअइ
  let out = syl.init.dev ? syl.init.dev + sign : TH_INDEP[sign];
  out += tail;
  if (syl.f === 'ng' && next && !next.raw && /^[कख]/.test(next.init.dev)) out += 'ं';   // ng before a velar
  else if (syl.f) out += TH_FINAL_DEV[syl.f];
  else if (isLast && syl.v === 'a') out += 'ः';                                   // final short a: หิมะ → हिमः
  return out;
}

function thConvert(text, mode) {
  if (!text) return '';
  let out = '', run = '';
  const flush = () => {
    if (!run) return;
    const { s } = thStripSilent(thRespell(run));
    const syls = thParse(s);
    out += mode === 'roman'
      ? syls.map(thRenderRoman).join('')
      : syls.map((x, k) => thRenderDev(x, syls[k + 1], k === syls.length - 1)).join('');
    run = '';
  };
  for (const ch of text.normalize('NFC')) {
    if (isThai(ch)) run += ch;
    else { flush(); out += ch; }
  }
  flush();
  return out;
}

export function toDev(text) { return thConvert(text, 'dev'); }
export function toRoman(text) { return thConvert(text, 'roman'); }
export const toPronunciation = toDev;

// Split a word into written syllables, keeping every original character: เครื่องบิน → ['เครื่อง','บิน']
export function breakSyllables(word) {
  if (!word) return [];
  const text = word.normalize('NFC');
  const parts = [];
  let run = '';
  const parsePlain = (chunk) => {
    if (!chunk) return;
    const { s, map } = thStripSilent(chunk);
    const syls = thParse(s);
    syls.forEach((x, k) => {
      const a = map[x.start], b = k + 1 < syls.length ? map[syls[k + 1].start] : chunk.length;
      if (b > a) parts.push(chunk.slice(a, b));
    });
  };
  const flush = () => {
    if (!run) return;
    let plain = '';
    for (let i = 0; i < run.length;) {
      const key = TH_SPOKEN_KEYS.find(k => run.startsWith(k, i));
      if (key) { parsePlain(plain); plain = ''; parts.push(...TH_PARTS[key]); i += key.length; }
      else { plain += run[i]; i++; }
    }
    parsePlain(plain);
    run = '';
  };
  for (const ch of text) {
    if (isThai(ch)) run += ch;
    else { flush(); if (ch.trim()) parts.push(ch); }
  }
  flush();
  return parts;
}
