// Japanese Language Data (Hiragana & Katakana)

export const japanese_hiragana = {
    id: 'japanese_hiragana',
    name: 'Hiragana',
    native: 'ひらがな',
    fontClass: 'japanese',
    fontFamily: 'Noto Sans JP',
    
    consonants: [
        { char: 'あ', roman: 'a' }, { char: 'い', roman: 'i' }, { char: 'う', roman: 'u' }, { char: 'え', roman: 'e' }, { char: 'お', roman: 'o' },
        { char: 'か', roman: 'ka' }, { char: 'き', roman: 'ki' }, { char: 'く', roman: 'ku' }, { char: 'け', roman: 'ke' }, { char: 'こ', roman: 'ko' },
        { char: 'さ', roman: 'sa' }, { char: 'し', roman: 'shi' }, { char: 'す', roman: 'su' }, { char: 'せ', roman: 'se' }, { char: 'そ', roman: 'so' },
        { char: 'た', roman: 'ta' }, { char: 'ち', roman: 'chi' }, { char: 'つ', roman: 'tsu' }, { char: 'て', roman: 'te' }, { char: 'と', roman: 'to' },
        { char: 'な', roman: 'na' }, { char: 'に', roman: 'ni' }, { char: 'ぬ', roman: 'nu' }, { char: 'ね', roman: 'ne' }, { char: 'の', roman: 'no' },
        { char: 'は', roman: 'ha' }, { char: 'ひ', roman: 'hi' }, { char: 'ふ', roman: 'fu' }, { char: 'へ', roman: 'he' }, { char: 'ほ', roman: 'ho' },
        { char: 'ま', roman: 'ma' }, { char: 'み', roman: 'mi' }, { char: 'む', roman: 'mu' }, { char: 'め', roman: 'me' }, { char: 'も', roman: 'mo' },
        { char: 'や', roman: 'ya' }, { char: 'ゆ', roman: 'yu' }, { char: 'よ', roman: 'yo' },
        { char: 'ら', roman: 'ra' }, { char: 'り', roman: 'ri' }, { char: 'る', roman: 'ru' }, { char: 'れ', roman: 're' }, { char: 'ろ', roman: 'ro' },
        { char: 'わ', roman: 'wa' }, { char: 'を', roman: 'wo' }, { char: 'ん', roman: 'n' }
    ],

    vowels: [],

    getDisplayLabel(charData) {
        return charData.roman;
    },

    hasDevanagari: false
};

export const japanese_katakana = {
    id: 'japanese_katakana',
    name: 'Katakana',
    native: 'カタカナ',
    fontClass: 'japanese',
    fontFamily: 'Noto Sans JP',
    
    consonants: [
        { char: 'ア', roman: 'a' }, { char: 'イ', roman: 'i' }, { char: 'ウ', roman: 'u' }, { char: 'エ', roman: 'e' }, { char: 'オ', roman: 'o' },
        { char: 'カ', roman: 'ka' }, { char: 'キ', roman: 'ki' }, { char: 'ク', roman: 'ku' }, { char: 'ケ', roman: 'ke' }, { char: 'コ', roman: 'ko' },
        { char: 'サ', roman: 'sa' }, { char: 'シ', roman: 'shi' }, { char: 'ス', roman: 'su' }, { char: 'セ', roman: 'se' }, { char: 'ソ', roman: 'so' },
        { char: 'タ', roman: 'ta' }, { char: 'チ', roman: 'chi' }, { char: 'ツ', roman: 'tsu' }, { char: 'テ', roman: 'te' }, { char: 'ト', roman: 'to' },
        { char: 'ナ', roman: 'na' }, { char: 'ニ', roman: 'ni' }, { char: 'ヌ', roman: 'nu' }, { char: 'ネ', roman: 'ne' }, { char: 'ノ', roman: 'no' },
        { char: 'ハ', roman: 'ha' }, { char: 'ヒ', roman: 'hi' }, { char: 'フ', roman: 'fu' }, { char: 'ヘ', roman: 'he' }, { char: 'ホ', roman: 'ho' },
        { char: 'マ', roman: 'ma' }, { char: 'ミ', roman: 'mi' }, { char: 'ム', roman: 'mu' }, { char: 'メ', roman: 'me' }, { char: 'モ', roman: 'mo' },
        { char: 'ヤ', roman: 'ya' }, { char: 'ユ', roman: 'yu' }, { char: 'ヨ', roman: 'yo' },
        { char: 'ラ', roman: 'ra' }, { char: 'リ', roman: 'ri' }, { char: 'ル', roman: 'ru' }, { char: 'レ', roman: 're' }, { char: 'ロ', roman: 'ro' },
        { char: 'ワ', roman: 'wa' }, { char: 'ヲ', roman: 'wo' }, { char: 'ン', roman: 'n' }
    ],

    vowels: [],

    getDisplayLabel(charData) {
        return charData.roman;
    },

    hasDevanagari: false
};
