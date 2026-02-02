// Chinese (Basic Characters) Language Data

export const chinese = {
    id: 'chinese',
    name: 'Chinese',
    native: '汉字',
    fontClass: 'chinese',
    fontFamily: 'Noto Sans SC',
    
    consonants: [
        { char: '一', roman: 'yī (one)' },
        { char: '二', roman: 'èr (two)' },
        { char: '三', roman: 'sān (three)' },
        { char: '四', roman: 'sì (four)' },
        { char: '五', roman: 'wǔ (five)' },
        { char: '六', roman: 'liù (six)' },
        { char: '七', roman: 'qī (seven)' },
        { char: '八', roman: 'bā (eight)' },
        { char: '九', roman: 'jiǔ (nine)' },
        { char: '十', roman: 'shí (ten)' },
        { char: '大', roman: 'dà (big)' },
        { char: '小', roman: 'xiǎo (small)' },
        { char: '人', roman: 'rén (person)' },
        { char: '口', roman: 'kǒu (mouth)' },
        { char: '日', roman: 'rì (sun)' },
        { char: '月', roman: 'yuè (moon)' },
        { char: '山', roman: 'shān (mountain)' },
        { char: '水', roman: 'shuǐ (water)' },
        { char: '火', roman: 'huǒ (fire)' },
        { char: '木', roman: 'mù (wood)' },
        { char: '金', roman: 'jīn (gold)' },
        { char: '土', roman: 'tǔ (earth)' },
        { char: '天', roman: 'tiān (sky)' },
        { char: '中', roman: 'zhōng (middle)' }
    ],

    vowels: [],

    getDisplayLabel(charData) {
        return charData.roman.split(' ')[0]; // Return just the pinyin
    },

    hasDevanagari: false
};
