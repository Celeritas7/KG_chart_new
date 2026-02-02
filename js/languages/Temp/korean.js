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
