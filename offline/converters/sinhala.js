// ═══ SINHALA TRANSLITERATION ENGINE ═══
// Uses character-by-character mapping with longest-match-first
// Source: sinhala.js consonant/vowel/medial/final/combination tables

// ─── CHARACTER TABLES ───

const CONSONANTS = [
  // Ka-group
  { char: 'ක', roman: 'ka', dev: 'क' },
  { char: 'ඛ', roman: 'kha', dev: 'ख' },
  { char: 'ග', roman: 'ga', dev: 'ग' },
  { char: 'ඝ', roman: 'gha', dev: 'घ' },
  { char: 'ඞ', roman: 'nga', dev: 'ङ' },
  { char: 'ඟ', roman: 'ṅga', dev: 'ंग' },   // Prenasalized nga (U+0D9F)
  // Cha-group
  { char: 'ච', roman: 'cha', dev: 'च' },
  { char: 'ඡ', roman: 'chha', dev: 'छ' },
  { char: 'ජ', roman: 'ja', dev: 'ज' },
  { char: 'ඣ', roman: 'jha', dev: 'झ' },
  { char: 'ඤ', roman: 'nya', dev: 'ञ' },
  // Ta-group (retroflex)
  { char: 'ට', roman: 'ṭa', dev: 'ट' },
  { char: 'ඨ', roman: 'ṭha', dev: 'ठ' },
  { char: 'ඩ', roman: 'ḍa', dev: 'ड' },
  { char: 'ඪ', roman: 'ḍha', dev: 'ढ' },
  { char: 'ණ', roman: 'ṇa', dev: 'ण' },
  // Ta-group (dental)
  { char: 'ත', roman: 'ta', dev: 'त' },
  { char: 'ථ', roman: 'tha', dev: 'थ' },
  { char: 'ද', roman: 'da', dev: 'द' },
  { char: 'ඳ', roman: 'nda', dev: 'ंद' },    // Prenasalized
  { char: 'ධ', roman: 'dha', dev: 'ध' },
  { char: 'න', roman: 'na', dev: 'न' },
  // Pa-group
  { char: 'ප', roman: 'pa', dev: 'प' },
  { char: 'ඵ', roman: 'pha', dev: 'फ' },
  { char: 'ෆ', roman: 'fa', dev: 'फ' },
  { char: 'බ', roman: 'ba', dev: 'ब' },
  { char: 'ඹ', roman: 'mba', dev: 'ंब' },    // Prenasalized
  { char: 'භ', roman: 'bha', dev: 'भ' },
  { char: 'ම', roman: 'ma', dev: 'म' },
  // Semi-vowels & sibilants
  { char: 'ය', roman: 'ya', dev: 'य' },
  { char: 'ර', roman: 'ra', dev: 'र' },
  { char: 'ල', roman: 'la', dev: 'ल' },
  { char: 'ව', roman: 'va', dev: 'व' },
  { char: 'ශ', roman: 'śa', dev: 'श' },
  { char: 'ෂ', roman: 'sha', dev: 'ष' },
  { char: 'ස', roman: 'sa', dev: 'स' },
  { char: 'හ', roman: 'ha', dev: 'ह' },
  { char: 'ළ', roman: 'ḷa', dev: 'ळ' },
  // Independent vowels (longer forms before shorter for greedy matching)
  { char: 'ආ', roman: 'ā', dev: 'आ' },
  { char: 'ඈ', roman: 'ǣ', dev: 'ॲ' },
  { char: 'ඉ', roman: 'i', dev: 'इ' },
  { char: 'ඊ', roman: 'ī', dev: 'ई' },
  { char: 'උ', roman: 'u', dev: 'उ' },
  { char: 'ඌ', roman: 'ū', dev: 'ऊ' },
  { char: 'ඍ', roman: 'ṛ', dev: 'ऋ' },
  { char: 'ඎ', roman: 'ṝ', dev: 'ॠ' },
  { char: 'එ', roman: 'e', dev: 'ए' },
  { char: 'ඒ', roman: 'ē', dev: 'ए' },
  { char: 'ඇ', roman: 'æ', dev: 'ॲ' },
  { char: 'ඓ', roman: 'ai', dev: 'ऐ' },
  { char: 'ඔ', roman: 'o', dev: 'ओ' },
  { char: 'ඕ', roman: 'ō', dev: 'ओ' },
  { char: 'ඖ', roman: 'au', dev: 'औ' },
  { char: 'අ', roman: 'a', dev: 'अ' },        // Short a — LAST (shortest match)
];

const VOWELS = [
  { char: 'ා', roman: 'ā', dev: 'ा' },
  { char: 'ි', roman: 'i', dev: 'ि' },
  { char: 'ී', roman: 'ī', dev: 'ी' },
  { char: 'ු', roman: 'u', dev: 'ु' },
  { char: 'ූ', roman: 'ū', dev: 'ू' },
  { char: 'ෙ', roman: 'e', dev: 'े' },
  { char: 'ේ', roman: 'ē', dev: 'े' },
  { char: 'ෛ', roman: 'ai', dev: 'ै' },
  { char: 'ො', roman: 'o', dev: 'ो' },
  { char: 'ෝ', roman: 'ō', dev: 'ो' },
  { char: 'ෟ', roman: 'au', dev: 'ौ' },
  { char: 'ෞ', roman: 'au', dev: 'ौ' },
  { char: 'ැ', roman: 'æ', dev: 'ॅ' },
  { char: 'ෑ', roman: 'ǣ', dev: 'ॅ' },
  { char: 'ෘ', roman: 'ru', dev: 'ृ' },
  { char: 'ෲ', roman: 'rū', dev: 'ॄ' },
];

const MEDIALS = [];

const FINALS = [
  { char: '්', roman: '', dev: '्' },
  { char: 'ං', roman: 'ṃ', dev: 'ं' },
  { char: 'ඁ', roman: 'ṁ', dev: 'ँ' },
  { char: 'ඃ', roman: 'ḥ', dev: 'ः' },
];

const COMBINATIONS = [
  { char: 'ක්ෂ', roman: 'ksha', dev: 'क्ष' },
  { char: 'ඥ', roman: 'dnya', dev: 'ज्ञ' },
];

// ─── BUILD LOOKUP (longest-match-first) ───

const allMappings = {};

for (const c of COMBINATIONS) allMappings[c.char] = c.dev;
for (const c of CONSONANTS) allMappings[c.char] = c.dev;
for (const v of VOWELS) allMappings[v.char] = v.dev;
for (const m of MEDIALS) allMappings[m.char] = m.dev;
for (const f of FINALS) allMappings[f.char] = f.dev;

const sortedKeys = Object.keys(allMappings).sort((a, b) => b.length - a.length);

// ─── TRANSLITERATION FUNCTION ───

export function toDev(sinhala) {
  if (!sinhala) return '';
  let result = '';
  let i = 0;
  const text = sinhala.trim();

  while (i < text.length) {
    let matched = false;
    for (const key of sortedKeys) {
      if (text.startsWith(key, i)) {
        result += allMappings[key];
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
  return result;
}

// ─── SYLLABLE BREAKDOWN ───

export function breakSyllables(word) {
  if (!word) return [];
  const syllables = [];
  let current = '';

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const code = ch.codePointAt(0);

    // Sinhala consonant range: U+0D9A - U+0DC6
    if (code >= 0x0D9A && code <= 0x0DC6 && current.length > 0) {
      // Don't split if previous char is virama (්)
      if (!current.endsWith('්')) {
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
