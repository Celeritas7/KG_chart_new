// ═══ CHINESE (MANDARIN) TRANSLITERATION ENGINE — compositional ═══
// A syllable's Devanagari is built by rule:  INITIAL + FINAL.
// Anything in the EXCEPTIONS tables OVERRIDES that rule.
//
// HOW IT WORKS
//   pinyin 'Hóngsède' → strip tones → segment ['hong','se','de']
//   → each syllable: EXCEPTIONS[syl]  ??  INITIALS[initial] + FINALS[final]
//   → re-attach tone suffix (´ ˇ ` -)
//
// ┌─────────────────────────────────────────────────────────────────┐
// │ TO ADD AN EXCEPTION: put  'pinyin': 'देवनागरी'  in USER_EXCEPTIONS │
// │ Use the TONELESS pinyin (e.g. 'si', not 'sì'). Tone is added auto. │
// └─────────────────────────────────────────────────────────────────┘

// ─── USER EXCEPTIONS — edit freely, these win over everything ───
const USER_EXCEPTIONS = {
  'si': 'सु',    // 四 sì — heard as "su" (apical buzzing vowel, not "see")
  // 'zi': 'ज़ु',   // dental buzz examples — uncomment / tune to taste
  // 'ci': 'त्सु',
  // 'shi': 'षर',  // retroflex buzz — r-coloured, not "u"
  // 'chi': 'छ्षर',
  // 'zhi': 'ज्षर',
  // 'ri':  'रर',
  // add your own below as you collect them ...
};

// ─── AUTO-PRESERVED IRREGULARS — generated from the old table; editable ───
const BASE_EXCEPTIONS = {
  'juan': 'जुवन',
  'jun': 'ज्विन',
  'quan': 'छुवन',
  'qun': 'छ्विन',
  'xuan': 'शुवन',
  'xun': 'श्विन'
};

// ─── TONE MARKS (pinyin diacritics → base vowel + tone number) ───
const TONE_MARKS = {
  'ā':{base:'a',tone:1},'á':{base:'a',tone:2},'ǎ':{base:'a',tone:3},'à':{base:'a',tone:4},
  'ē':{base:'e',tone:1},'é':{base:'e',tone:2},'ě':{base:'e',tone:3},'è':{base:'e',tone:4},
  'ī':{base:'i',tone:1},'í':{base:'i',tone:2},'ǐ':{base:'i',tone:3},'ì':{base:'i',tone:4},
  'ō':{base:'o',tone:1},'ó':{base:'o',tone:2},'ǒ':{base:'o',tone:3},'ò':{base:'o',tone:4},
  'ū':{base:'u',tone:1},'ú':{base:'u',tone:2},'ǔ':{base:'u',tone:3},'ù':{base:'u',tone:4},
  'ǖ':{base:'ü',tone:1},'ǘ':{base:'ü',tone:2},'ǚ':{base:'ü',tone:3},'ǜ':{base:'ü',tone:4},
};
const TONE_SUFFIXES = { 1:'-', 2:'´', 3:'ˇ', 4:'`' };

// ─── INITIALS (pinyin onset → Devanagari) ───
const INITIALS = {
  'b': 'ब', 'p': 'फ्फ', 'm': 'म', 'f': 'फ',
  'd': 'द', 't': 'थ', 'n': 'न', 'l': 'ल',
  'g': 'ग', 'k': 'ख', 'h': 'ह', 'j': 'ज',
  // Three families: palatal j q x use plain letters; retroflex zh ch sh add ष
  // ("curl the tongue back"); dental z c s sit at the teeth. Aspirated q and ch use छ.
  'q': 'छ', 'x': 'श', 'zh': 'ज्ष', 'ch': 'छ्ष',
  'sh': 'ष', 'r': 'र', 'z': 'ज़', 'c': 'त्स',
  's': 'स',
};

// ─── FINALS (pinyin rime → Devanagari) ───
const FINALS = {
  'a': 'ा', 'ai': 'ाय', 'an': 'ान', 'ang': 'ांग',
  'ao': 'ाव', 'e': '', 'ei': 'ै', 'en': 'न्',
  'eng': 'ंग', 'er': 'ार्र', 'i': 'ि', 'ia': '्या',
  'ian': '्येन', 'iang': '्यांग', 'iao': '्याव', 'ie': 'िये',
  'in': 'िन', 'ing': 'ियंग', 'iong': '्योंग', 'iu': '्योउ',
  'o': 'ो', 'ong': 'ोंग', 'ou': 'ोउ', 'u': 'ु',
  'ua': '्वा', 'uai': '्वाय', 'uan': '्वान', 'uang': 'ुआंग',
  'ue': 'ुए', 'ueng': 'ुअंग', 'ui': '्वै', 'un': '्वन',
  'uo': '्वॉ', 'ü': '्यू', 'üan': '्यूआन', 'üe': '्यूअ',
  'ün': '्यून',
};

// ─── INDEPENDENT (zero-initial syllables: a, ya, wu, er, …) ───
const INDEPENDENT = {
  'a': 'आ', 'ai': 'आय', 'an': 'आन', 'ang': 'आंग',
  'ao': 'आव', 'e': 'अ', 'ei': 'अै', 'en': 'अन',
  'eng': 'अंग', 'er': 'अर्र', 'i': 'इ', 'ia': '्या',
  'ian': '्येन', 'iang': 'यांग', 'iao': 'इयाव', 'ie': 'इये',
  'in': 'इन', 'ing': 'यंग', 'iong': '्योंग', 'iu': 'इयोउ',
  'o': 'ओ', 'ong': 'ओंग', 'ou': 'ओउ', 'u': 'उ',
  'ua': 'वा', 'uai': 'वाय', 'uan': 'वान', 'uang': 'उआंग',
  'ue': 'उये', 'ueng': 'उअंग', 'ui': 'वै', 'un': 'उअन',
  'uo': 'वॉ', 'wa': 'वा', 'wai': 'वाय', 'wan': 'वान',
  'wang': 'वांग', 'wao': 'वाव', 'we': 'व', 'wei': 'वै',
  'wen': 'वन्', 'weng': 'वंग', 'wer': 'वार्र', 'wi': 'वि',
  'wia': 'व्या', 'wian': 'व्येन', 'wiang': 'व्यांग', 'wiao': 'व्याव',
  'wie': 'विये', 'win': 'विन', 'wing': 'वियंग', 'wiong': 'व्योंग',
  'wiu': 'व्योउ', 'wo': 'वो', 'wong': 'वोंग', 'wou': 'वोउ',
  'wu': 'उ', 'wua': 'वा', 'wuai': 'वाय', 'wuan': 'वान',
  'wuang': 'उआंग', 'wue': 'उये', 'wueng': 'उअंग', 'wui': 'वै',
  'wun': 'उअन', 'wuo': 'वॉ', 'wü': 'व्यू', 'wüan': 'व्यूआन',
  'wüe': 'व्यूअ', 'wün': 'व्यून', 'ya': 'या', 'yai': 'याय',
  'yan': 'यान', 'yang': 'यांग', 'yao': 'याव', 'ye': 'ये',
  'yei': 'यै', 'yen': 'यन्', 'yeng': 'यंग', 'yer': 'यार्र',
  'yi': 'इ', 'yia': '्या', 'yian': '्येन', 'yiang': 'यांग',
  'yiao': 'इयाव', 'yie': 'इये', 'yin': 'इन', 'ying': 'यंग',
  'yiong': '्योंग', 'yiu': 'इयोउ', 'yo': 'यो', 'yong': 'योंग',
  'you': 'योउ', 'yu': 'यु', 'yua': 'य्वा', 'yuai': 'य्वाय',
  'yuan': 'य्वान', 'yuang': 'युआंग', 'yue': 'युए', 'yueng': 'युअंग',
  'yui': 'य्वै', 'yun': 'विन', 'yuo': 'य्वॉ', 'yü': 'य्यू',
  'yüan': 'य्यूआन', 'yüe': 'य्यूअ', 'yün': 'य्यून', 'ü': 'यू',
  'üan': 'यूआन', 'üe': 'यूअ', 'ün': 'यून',
};

// onsets, longest-first (zh/ch/sh before single letters)
const INIT_LIST = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "z", "c", "s", "r"];

// valid syllable inventory, longest-first — used for segmenting run-together pinyin
const VALID = ["chiang", "chiong", "chuang", "chueng", "shiang", "shiong", "shuang", "shueng", "zhiang", "zhiong", "zhuang", "zhueng", "biang", "biong", "buang", "bueng", "chang", "cheng", "chian", "chiao", "ching", "chong", "chuai", "chuan", "ch\u00fcan", "ciang", "ciong", "cuang", "cueng", "diang", "diong", "duang", "dueng", "fiang", "fiong", "fuang", "fueng", "giang", "giong", "guang", "gueng", "hiang", "hiong", "huang", "hueng", "jiang", "jiong", "juang", "jueng", "kiang", "kiong", "kuang", "kueng", "liang", "liong", "luang", "lueng", "miang", "miong", "muang", "mueng", "niang", "niong", "nuang", "nueng", "piang", "piong", "puang", "pueng", "qiang", "qiong", "quang", "queng", "riang", "riong", "ruang", "rueng", "shang", "sheng", "shian", "shiao", "shing", "shong", "shuai", "shuan", "sh\u00fcan", "siang", "siong", "suang", "sueng", "tiang", "tiong", "tuang", "tueng", "wiang", "wiong", "wuang", "wueng", "xiang", "xiong", "xuang", "xueng", "yiang", "yiong", "yuang", "yueng", "zhang", "zheng", "zhian", "zhiao", "zhing", "zhong", "zhuai", "zhuan", "zh\u00fcan", "ziang", "ziong", "zuang", "zueng", "bang", "beng", "bian", "biao", "bing", "bong", "buai", "buan", "b\u00fcan", "cang", "ceng", "chai", "chan", "chao", "chei", "chen", "cher", "chia", "chie", "chin", "chiu", "chou", "chua", "chue", "chui", "chun", "chuo", "ch\u00fce", "ch\u00fcn", "cian", "ciao", "cing", "cong", "cuai", "cuan", "c\u00fcan", "dang", "deng", "dian", "diao", "ding", "dong", "duai", "duan", "d\u00fcan", "fang", "feng", "fian", "fiao", "fing", "fong", "fuai", "fuan", "f\u00fcan", "gang", "geng", "gian", "giao", "ging", "gong", "guai", "guan", "g\u00fcan", "hang", "heng", "hian", "hiao", "hing", "hong", "huai", "huan", "h\u00fcan", "iang", "iong", "jang", "jeng", "jian", "jiao", "jing", "jong", "juai", "juan", "j\u00fcan", "kang", "keng", "kian", "kiao", "king", "kong", "kuai", "kuan", "k\u00fcan", "lang", "leng", "lian", "liao", "ling", "long", "luai", "luan", "l\u00fcan", "mang", "meng", "mian", "miao", "ming", "mong", "muai", "muan", "m\u00fcan", "nang", "neng", "nian", "niao", "ning", "nong", "nuai", "nuan", "n\u00fcan", "pang", "peng", "pian", "piao", "ping", "pong", "puai", "puan", "p\u00fcan", "qang", "qeng", "qian", "qiao", "qing", "qong", "quai", "quan", "q\u00fcan", "rang", "reng", "rian", "riao", "ring", "rong", "ruai", "ruan", "r\u00fcan", "sang", "seng", "shai", "shan", "shao", "shei", "shen", "sher", "shia", "shie", "shin", "shiu", "shou", "shua", "shue", "shui", "shun", "shuo", "sh\u00fce", "sh\u00fcn", "sian", "siao", "sing", "song", "suai", "suan", "s\u00fcan", "tang", "teng", "tian", "tiao", "ting", "tong", "tuai", "tuan", "t\u00fcan", "uang", "ueng", "wang", "weng", "wian", "wiao", "wing", "wong", "wuai", "wuan", "w\u00fcan", "xang", "xeng", "xian", "xiao", "xing", "xong", "xuai", "xuan", "x\u00fcan", "yang", "yeng", "yian", "yiao", "ying", "yong", "yuai", "yuan", "y\u00fcan", "zang", "zeng", "zhai", "zhan", "zhao", "zhei", "zhen", "zher", "zhia", "zhie", "zhin", "zhiu", "zhou", "zhua", "zhue", "zhui", "zhun", "zhuo", "zh\u00fce", "zh\u00fcn", "zian", "ziao", "zing", "zong", "zuai", "zuan", "z\u00fcan", "ang", "bai", "ban", "bao", "bei", "ben", "ber", "bia", "bie", "bin", "biu", "bou", "bua", "bue", "bui", "bun", "buo", "b\u00fce", "b\u00fcn", "cai", "can", "cao", "cei", "cen", "cer", "cha", "che", "chi", "cho", "chu", "ch\u00fc", "cia", "cie", "cin", "ciu", "cou", "cua", "cue", "cui", "cun", "cuo", "c\u00fce", "c\u00fcn", "dai", "dan", "dao", "dei", "den", "der", "dia", "die", "din", "diu", "dou", "dua", "due", "dui", "dun", "duo", "d\u00fce", "d\u00fcn", "eng", "fai", "fan", "fao", "fei", "fen", "fer", "fia", "fie", "fin", "fiu", "fou", "fua", "fue", "fui", "fun", "fuo", "f\u00fce", "f\u00fcn", "gai", "gan", "gao", "gei", "gen", "ger", "gia", "gie", "gin", "giu", "gou", "gua", "gue", "gui", "gun", "guo", "g\u00fce", "g\u00fcn", "hai", "han", "hao", "hei", "hen", "her", "hia", "hie", "hin", "hiu", "hou", "hua", "hue", "hui", "hun", "huo", "h\u00fce", "h\u00fcn", "ian", "iao", "ing", "jai", "jan", "jao", "jei", "jen", "jer", "jia", "jie", "jin", "jiu", "jou", "jua", "jue", "jui", "jun", "juo", "j\u00fce", "j\u00fcn", "kai", "kan", "kao", "kei", "ken", "ker", "kia", "kie", "kin", "kiu", "kou", "kua", "kue", "kui", "kun", "kuo", "k\u00fce", "k\u00fcn", "lai", "lan", "lao", "lei", "len", "ler", "lia", "lie", "lin", "liu", "lou", "lua", "lue", "lui", "lun", "luo", "l\u00fce", "l\u00fcn", "mai", "man", "mao", "mei", "men", "mer", "mia", "mie", "min", "miu", "mou", "mua", "mue", "mui", "mun", "muo", "m\u00fce", "m\u00fcn", "nai", "nao", "nei", "nen", "ner", "nia", "nie", "nin", "niu", "nou", "nua", "nue", "nui", "nun", "nuo", "n\u00fce", "n\u00fcn", "ong", "pai", "pan", "pao", "pei", "pen", "per", "pia", "pie", "pin", "piu", "pou", "pua", "pue", "pui", "pun", "puo", "p\u00fce", "p\u00fcn", "qai", "qan", "qao", "qei", "qen", "qer", "qia", "qie", "qin", "qiu", "qou", "qua", "que", "qui", "qun", "quo", "q\u00fce", "q\u00fcn", "rai", "ran", "rao", "rei", "ren", "rer", "ria", "rie", "rin", "riu", "rou", "rua", "rue", "rui", "run", "ruo", "r\u00fce", "r\u00fcn", "sai", "san", "sao", "sei", "sen", "ser", "sha", "she", "shi", "sho", "shu", "sh\u00fc", "sia", "sie", "sin", "siu", "sou", "sua", "sue", "sui", "sun", "suo", "s\u00fce", "s\u00fcn", "tai", "tan", "tao", "tei", "ten", "ter", "tia", "tie", "tin", "tiu", "tou", "tua", "tue", "tui", "tun", "tuo", "t\u00fce", "t\u00fcn", "uai", "uan", "wai", "wan", "wao", "wei", "wen", "wer", "wia", "wie", "win", "wiu", "wou", "wua", "wue", "wui", "wun", "wuo", "w\u00fce", "w\u00fcn", "xai", "xan", "xao", "xei", "xen", "xer", "xia", "xie", "xin", "xiu", "xou", "xua", "xue", "xui", "xun", "xuo", "x\u00fce", "x\u00fcn", "yai", "yan", "yao", "yei", "yen", "yer", "yia", "yie", "yin", "yiu", "you", "yua", "yue", "yui", "yun", "yuo", "y\u00fce", "y\u00fcn", "zai", "zan", "zao", "zei", "zen", "zer", "zha", "zhe", "zhi", "zho", "zhu", "zh\u00fc", "zia", "zie", "zin", "ziu", "zou", "zua", "zue", "zui", "zun", "zuo", "z\u00fce", "z\u00fcn", "\u00fcan", "ai", "an", "ao", "ba", "be", "bi", "bo", "bu", "b\u00fc", "ca", "ce", "ci", "co", "cu", "c\u00fc", "da", "de", "di", "do", "du", "d\u00fc", "ei", "en", "er", "fa", "fe", "fi", "fo", "fu", "f\u00fc", "ga", "ge", "gi", "go", "gu", "g\u00fc", "ha", "he", "hi", "ho", "hu", "h\u00fc", "ia", "ie", "in", "iu", "ja", "je", "ji", "jo", "ju", "j\u00fc", "ka", "ke", "ki", "ko", "ku", "k\u00fc", "la", "le", "li", "lo", "lu", "l\u00fc", "ma", "me", "mi", "mo", "mu", "m\u00fc", "na", "ne", "ni", "no", "nu", "n\u00fc", "ou", "pa", "pe", "pi", "po", "pu", "p\u00fc", "qa", "qe", "qi", "qo", "qu", "q\u00fc", "ra", "re", "ri", "ro", "ru", "r\u00fc", "sa", "se", "si", "so", "su", "s\u00fc", "ta", "te", "ti", "to", "tu", "t\u00fc", "ua", "ue", "ui", "un", "uo", "wa", "we", "wi", "wo", "wu", "w\u00fc", "xa", "xe", "xi", "xo", "xu", "x\u00fc", "ya", "ye", "yi", "yo", "yu", "y\u00fc", "za", "ze", "zi", "zo", "zu", "z\u00fc", "\u00fce", "\u00fcn", "a", "e", "i", "o", "u", "\u00fc"];

// merged exceptions: USER overrides BASE
const EXCEPTIONS = { ...BASE_EXCEPTIONS, ...USER_EXCEPTIONS };

// ─── CORE ───
function splitInitial(s) {
  for (const ini of INIT_LIST) {
    if (s.startsWith(ini) && s.length > ini.length) return [ini, s.slice(ini.length)];
  }
  return ['', s];
}

// toneless pinyin syllable → Devanagari (exception wins, else compose)
function renderSyllable(syl) {
  if (EXCEPTIONS[syl] != null) return EXCEPTIONS[syl];
  const [ini, fin] = splitInitial(syl);
  if (ini === '') return INDEPENDENT[syl] != null ? INDEPENDENT[syl] : syl;
  return (INITIALS[ini] || '') + (FINALS[fin] != null ? FINALS[fin] : fin);
}

// ─── TRANSLITERATION ───
export function toDev(pinyinText) {
  if (!pinyinText) return '';
  const words = pinyinText.trim().split(/\s+/);

  return words.map(word => {
    // strip tone diacritics, remember where each tone sat
    let bare = '';
    const toneAt = [];
    for (const ch of word) {
      const lower = ch.toLowerCase();
      if (TONE_MARKS[lower]) { toneAt.push({ pos: bare.length, tone: TONE_MARKS[lower].tone }); bare += TONE_MARKS[lower].base; }
      else bare += lower;
    }

    // segment longest-first, render each, re-attach tone
    const parts = [];
    let i = 0;
    while (i < bare.length) {
      let matched = false;
      for (const key of VALID) {
        if (bare.startsWith(key, i)) {
          let tone = 0;
          for (const t of toneAt) { if (t.pos >= i && t.pos < i + key.length) { tone = t.tone; break; } }
          const dev = renderSyllable(key);
          const suffix = tone && TONE_SUFFIXES[tone] ? TONE_SUFFIXES[tone] : '';
          parts.push(dev + suffix);
          i += key.length; matched = true; break;
        }
      }
      if (!matched) { parts.push(bare[i]); i++; }
    }
    return parts.join('');
  }).join(' ');
}

// ─── SYLLABLE BREAKDOWN ───
export function breakSyllables(pinyinText) {
  if (!pinyinText) return [];
  const out = [];
  for (const word of pinyinText.trim().split(/\s+/)) {
    let bare = '';
    for (const ch of word) { const l = ch.toLowerCase(); bare += TONE_MARKS[l] ? TONE_MARKS[l].base : l; }
    let i = 0;
    while (i < bare.length) {
      let matched = false;
      for (const key of VALID) { if (bare.startsWith(key, i)) { out.push(key); i += key.length; matched = true; break; } }
      if (!matched) { out.push(bare[i]); i++; }
    }
  }
  return out;
}
