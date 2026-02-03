"""
Chinese Language Processor

Converts Chinese (Hanzi) to:
- Pinyin (using pypinyin library)
- Devanagari transliteration (from Pinyin)

Based on the Pinyin → Devanagari mapping table provided.
"""

from typing import Dict, Any
from .base import LanguageProcessor, ProcessedWord

try:
    from pypinyin import pinyin, Style
    PYPINYIN_AVAILABLE = True
except ImportError:
    PYPINYIN_AVAILABLE = False
    print("Warning: pypinyin not installed. Run: pip install pypinyin")


# Pinyin to Devanagari mapping (based on provided table)
PINYIN_TO_DEVANAGARI = {
    # Initials (Consonants)
    'k': 'ख', 'g': 'ग', 'ng': 'ङं',
    'q': 'छ', 'j': 'ज', 'c': 'त्स', 'z': 'द्स',
    'ch': 'च्ह', 'zh': 'ज्ह',
    't': 'थ', 'd': 'द',
    'p': 'फ', 'b': 'ब',
    'n': 'न', 'm': 'म',
    'y': 'य', 'w': 'व',
    'r': 'झ्र', 'x': 'श', 'sh': 'ष', 's': 'स',
    'h': 'ह्', 'l': 'ल', 'f': 'फ',
    
    # Vowels / Finals
    'a': 'आ', 'ai': 'आइ', 'an': 'आन', 'ang': 'आंग', 'ao': 'आओ',
    'e': 'अ', 'ei': 'एइ', 'en': 'एन', 'eng': 'एंग', 'er': 'अर',
    'i': 'इ', 'ia': 'इया', 'ian': 'इयान', 'iang': 'इयांग', 'iao': 'इयाओ',
    'ie': 'इए', 'in': 'इन', 'ing': 'इंग', 'iong': 'इओंग', 'iu': 'इउ',
    'o': 'ओ', 'ong': 'ओंग', 'ou': 'ओउ',
    'u': 'उ', 'ua': 'उआ', 'uai': 'उआइ', 'uan': 'उआन', 'uang': 'उआंग',
    'ue': 'उए', 'ui': 'उइ', 'un': 'उन', 'uo': 'उओ',
    'v': 'उ', 've': 'उए', 'ü': 'उ', 'üe': 'उए',
    
    # Common syllables (for better accuracy)
    'ba': 'बा', 'pa': 'फा', 'ma': 'मा', 'fa': 'फा',
    'da': 'दा', 'ta': 'था', 'na': 'ना', 'la': 'ला',
    'ga': 'गा', 'ka': 'खा', 'ha': 'हा',
    'za': 'द्सा', 'ca': 'त्सा', 'sa': 'सा',
    'zha': 'ज्हा', 'cha': 'च्हा', 'sha': 'षा', 'ra': 'झ्रा',
    'ji': 'जी', 'qi': 'छी', 'xi': 'शी',
    'bi': 'बी', 'pi': 'फी', 'mi': 'मी',
    'di': 'दी', 'ti': 'थी', 'ni': 'नी', 'li': 'ली',
    'zi': 'द्सी', 'ci': 'त्सी', 'si': 'सी',
    'zhi': 'ज्ही', 'chi': 'च्ही', 'shi': 'षी', 'ri': 'झ्री',
    'bu': 'बु', 'pu': 'फु', 'mu': 'मु', 'fu': 'फु',
    'du': 'दु', 'tu': 'थु', 'nu': 'नु', 'lu': 'लु',
    'gu': 'गु', 'ku': 'खु', 'hu': 'हु',
    'zu': 'द्सु', 'cu': 'त्सु', 'su': 'सु',
    'zhu': 'ज्हु', 'chu': 'च्हु', 'shu': 'षु', 'ru': 'झ्रु',
    'ju': 'जु', 'qu': 'छु', 'xu': 'शु',
    'bo': 'बो', 'po': 'फो', 'mo': 'मो', 'fo': 'फो',
    'lo': 'लो',
    'ge': 'गे', 'ke': 'खे', 'he': 'हे',
    'ze': 'द्से', 'ce': 'त्से', 'se': 'से',
    'zhe': 'ज्हे', 'che': 'च्हे', 'she': 'षे', 're': 'झ्रे',
    'de': 'दे', 'te': 'थे', 'ne': 'ने', 'le': 'ले',
    'me': 'मे',
    'bei': 'बेइ', 'pei': 'फेइ', 'mei': 'मेइ', 'fei': 'फेइ',
    'dei': 'देइ', 'nei': 'नेइ', 'lei': 'लेइ',
    'gei': 'गेइ',
    'wei': 'वेइ',
    'ben': 'बेन', 'pen': 'फेन', 'men': 'मेन', 'fen': 'फेन',
    'den': 'देन', 'nen': 'नेन',
    'gen': 'गेन', 'ken': 'खेन', 'hen': 'हेन',
    'zen': 'द्सेन', 'cen': 'त्सेन', 'sen': 'सेन',
    'zhen': 'ज्हेन', 'chen': 'च्हेन', 'shen': 'षेन', 'ren': 'झ्रेन',
    'wen': 'वेन',
    'beng': 'बेंग', 'peng': 'फेंग', 'meng': 'मेंग', 'feng': 'फेंग',
    'deng': 'देंग', 'teng': 'थेंग', 'neng': 'नेंग', 'leng': 'लेंग',
    'geng': 'गेंग', 'keng': 'खेंग', 'heng': 'हेंग',
    'zeng': 'द्सेंग', 'ceng': 'त्सेंग', 'seng': 'सेंग',
    'zheng': 'ज्हेंग', 'cheng': 'च्हेंग', 'sheng': 'षेंग', 'reng': 'झ्रेंग',
    'weng': 'वेंग',
    'bai': 'बाइ', 'pai': 'फाइ', 'mai': 'माइ',
    'dai': 'दाइ', 'tai': 'थाइ', 'nai': 'नाइ', 'lai': 'लाइ',
    'gai': 'गाइ', 'kai': 'खाइ', 'hai': 'हाइ',
    'zai': 'द्साइ', 'cai': 'त्साइ', 'sai': 'साइ',
    'zhai': 'ज्हाइ', 'chai': 'च्हाइ', 'shai': 'षाइ',
    'wai': 'वाइ',
    'ban': 'बान', 'pan': 'फान', 'man': 'मान', 'fan': 'फान',
    'dan': 'दान', 'tan': 'थान', 'nan': 'नान', 'lan': 'लान',
    'gan': 'गान', 'kan': 'खान', 'han': 'हान',
    'zan': 'द्सान', 'can': 'त्सान', 'san': 'सान',
    'zhan': 'ज्हान', 'chan': 'च्हान', 'shan': 'षान', 'ran': 'झ्रान',
    'wan': 'वान',
    'bang': 'बांग', 'pang': 'फांग', 'mang': 'मांग', 'fang': 'फांग',
    'dang': 'दांग', 'tang': 'थांग', 'nang': 'नांग', 'lang': 'लांग',
    'gang': 'गांग', 'kang': 'खांग', 'hang': 'हांग',
    'zang': 'द्सांग', 'cang': 'त्सांग', 'sang': 'सांग',
    'zhang': 'ज्हांग', 'chang': 'च्हांग', 'shang': 'षांग', 'rang': 'झ्रांग',
    'wang': 'वांग',
    'bao': 'बाओ', 'pao': 'फाओ', 'mao': 'माओ',
    'dao': 'दाओ', 'tao': 'थाओ', 'nao': 'नाओ', 'lao': 'लाओ',
    'gao': 'गाओ', 'kao': 'खाओ', 'hao': 'हाओ',
    'zao': 'द्साओ', 'cao': 'त्साओ', 'sao': 'साओ',
    'zhao': 'ज्हाओ', 'chao': 'च्हाओ', 'shao': 'षाओ', 'rao': 'झ्राओ',
    'yao': 'याओ',
    'bian': 'बियान', 'pian': 'फियान', 'mian': 'मियान',
    'dian': 'दियान', 'tian': 'थियान', 'nian': 'नियान', 'lian': 'लियान',
    'jian': 'जियान', 'qian': 'छियान', 'xian': 'शियान',
    'yan': 'यान',
    'biao': 'बियाओ', 'piao': 'फियाओ', 'miao': 'मियाओ',
    'diao': 'दियाओ', 'tiao': 'थियाओ', 'niao': 'नियाओ', 'liao': 'लियाओ',
    'jiao': 'जियाओ', 'qiao': 'छियाओ', 'xiao': 'शियाओ',
    'bie': 'बिए', 'pie': 'फिए', 'mie': 'मिए',
    'die': 'दिए', 'tie': 'थिए', 'nie': 'निए', 'lie': 'लिए',
    'jie': 'जिए', 'qie': 'छिए', 'xie': 'शिए',
    'ye': 'ये',
    'bin': 'बिन', 'pin': 'फिन', 'min': 'मिन',
    'nin': 'निन', 'lin': 'लिन',
    'jin': 'जिन', 'qin': 'छिन', 'xin': 'शिन',
    'yin': 'यिन',
    'bing': 'बिंग', 'ping': 'फिंग', 'ming': 'मिंग',
    'ding': 'दिंग', 'ting': 'थिंग', 'ning': 'निंग', 'ling': 'लिंग',
    'jing': 'जिंग', 'qing': 'छिंग', 'xing': 'शिंग',
    'ying': 'यिंग',
    'diu': 'दिउ', 'niu': 'निउ', 'liu': 'लिउ',
    'jiu': 'जिउ', 'qiu': 'छिउ', 'xiu': 'शिउ',
    'you': 'योउ',
    'dong': 'दोंग', 'tong': 'थोंग', 'nong': 'नोंग', 'long': 'लोंग',
    'gong': 'गोंग', 'kong': 'खोंग', 'hong': 'होंग',
    'zong': 'द्सोंग', 'cong': 'त्सोंग', 'song': 'सोंग',
    'zhong': 'ज्होंग', 'chong': 'च्होंग', 'rong': 'झ्रोंग',
    'yong': 'योंग',
    'dou': 'दोउ', 'tou': 'थोउ', 'nou': 'नोउ', 'lou': 'लोउ',
    'gou': 'गोउ', 'kou': 'खोउ', 'hou': 'होउ',
    'zou': 'द्सोउ', 'cou': 'त्सोउ', 'sou': 'सोउ',
    'zhou': 'ज्होउ', 'chou': 'च्होउ', 'shou': 'षोउ', 'rou': 'झ्रोउ',
    'duan': 'दुआन', 'tuan': 'थुआन', 'nuan': 'नुआन', 'luan': 'लुआन',
    'guan': 'गुआन', 'kuan': 'खुआन', 'huan': 'हुआन',
    'zuan': 'द्सुआन', 'cuan': 'त्सुआन', 'suan': 'सुआन',
    'zhuan': 'ज्हुआन', 'chuan': 'च्हुआन', 'shuan': 'षुआन', 'ruan': 'झ्रुआन',
    'yuan': 'युआन',
    'juan': 'जुआन', 'quan': 'छुआन', 'xuan': 'शुआन',
    'dui': 'दुइ', 'tui': 'थुइ',
    'gui': 'गुइ', 'kui': 'खुइ', 'hui': 'हुइ',
    'zui': 'द्सुइ', 'cui': 'त्सुइ', 'sui': 'सुइ',
    'zhui': 'ज्हुइ', 'chui': 'च्हुइ', 'shui': 'षुइ', 'rui': 'झ्रुइ',
    'dun': 'दुन', 'tun': 'थुन', 'nun': 'नुन', 'lun': 'लुन',
    'gun': 'गुन', 'kun': 'खुन', 'hun': 'हुन',
    'zun': 'द्सुन', 'cun': 'त्सुन', 'sun': 'सुन',
    'zhun': 'ज्हुन', 'chun': 'च्हुन', 'shun': 'षुन', 'run': 'झ्रुन',
    'yun': 'युन',
    'jun': 'जुन', 'qun': 'छुन', 'xun': 'शुन',
    'duo': 'दुओ', 'tuo': 'थुओ', 'nuo': 'नुओ', 'luo': 'लुओ',
    'guo': 'गुओ', 'kuo': 'खुओ', 'huo': 'हुओ',
    'zuo': 'द्सुओ', 'cuo': 'त्सुओ', 'suo': 'सुओ',
    'zhuo': 'ज्हुओ', 'chuo': 'च्हुओ', 'shuo': 'षुओ', 'ruo': 'झ्रुओ',
    'wo': 'वो',
    'jue': 'जुए', 'que': 'छुए', 'xue': 'शुए', 'yue': 'युए',
    'nv': 'नु', 'lv': 'लु', 'nü': 'नु', 'lü': 'लु',
}

# Tone mark removal mapping
TONE_MARKS = {
    'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
    'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
    'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
    'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
    'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
    'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü',
}


class ChineseProcessor(LanguageProcessor):
    """
    Processor for Chinese (Mandarin) language.
    
    Converts Hanzi to:
    - Pinyin with tone marks
    - Devanagari transliteration (from Pinyin)
    """
    
    def __init__(self):
        super().__init__(language_code='zh', language_name='Chinese')
    
    def process_word(self, native_text: str, **kwargs) -> ProcessedWord:
        """
        Process a Chinese word.
        
        Args:
            native_text: Chinese characters (Hanzi)
            **kwargs: Optional 'pinyin' if already known
            
        Returns:
            ProcessedWord with all fields
        """
        # Generate pronunciation (Pinyin)
        pronunciation = self.generate_pronunciation(native_text, **kwargs)
        
        # Generate Devanagari from Pinyin
        pinyin_text = pronunciation.get('pinyin', '')
        devanagari = kwargs.get('devanagari') or self.generate_devanagari(native_text, pinyin=pinyin_text)
        
        return ProcessedWord(
            native_text=native_text,
            devanagari=devanagari,
            pronunciation=pronunciation,
            notes=kwargs.get('notes')
        )
    
    def generate_pronunciation(self, native_text: str, **kwargs) -> Dict[str, str]:
        """
        Generate Pinyin from Chinese text.
        """
        if kwargs.get('pinyin'):
            return {'pinyin': kwargs['pinyin']}
        
        if not PYPINYIN_AVAILABLE:
            return {'pinyin': native_text}
        
        # Get pinyin with tone marks
        result = pinyin(native_text, style=Style.TONE)
        pinyin_text = ''.join([item[0] for item in result])
        
        return {'pinyin': pinyin_text}
    
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        """
        Generate Devanagari from Chinese text via Pinyin.
        """
        if kwargs.get('devanagari'):
            return kwargs['devanagari']
        
        pinyin_text = kwargs.get('pinyin', '')
        
        if not pinyin_text:
            pronunciation = self.generate_pronunciation(native_text)
            pinyin_text = pronunciation.get('pinyin', '')
        
        return self._pinyin_to_devanagari(pinyin_text)
    
    def _remove_tone_marks(self, text: str) -> str:
        """Remove tone marks from Pinyin."""
        result = []
        for char in text:
            result.append(TONE_MARKS.get(char, char))
        return ''.join(result)
    
    def _pinyin_to_devanagari(self, pinyin_text: str) -> str:
        """
        Convert Pinyin to Devanagari.
        """
        if not pinyin_text:
            return ''
        
        # Remove tone marks for mapping
        clean_pinyin = self._remove_tone_marks(pinyin_text.lower())
        
        result = []
        i = 0
        
        while i < len(clean_pinyin):
            matched = False
            
            # Try matching longer strings first (6, 5, 4, 3, 2, 1 chars)
            for length in [6, 5, 4, 3, 2, 1]:
                if i + length <= len(clean_pinyin):
                    chunk = clean_pinyin[i:i+length]
                    if chunk in PINYIN_TO_DEVANAGARI:
                        result.append(PINYIN_TO_DEVANAGARI[chunk])
                        i += length
                        matched = True
                        break
            
            if not matched:
                # Keep unmapped characters
                if clean_pinyin[i].isalpha():
                    result.append(clean_pinyin[i])
                i += 1
        
        return ''.join(result)
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from CSV data.
        
        Expected columns:
        - 'Chinese' or 'chinese' or 'hanzi' or 'native_text': Chinese text
        - 'English' or 'english': English translation
        - 'pinyin' (optional): Pre-computed Pinyin
        """
        native_text = (
            row.get('Chinese') or 
            row.get('chinese') or 
            row.get('hanzi') or 
            row.get('native_text') or 
            row.get('Native') or
            ''
        )
        
        return self.process_word(
            native_text=native_text,
            pinyin=row.get('pinyin'),
            devanagari=row.get('devanagari'),
            notes=row.get('notes')
        )


# Quick test
if __name__ == "__main__":
    processor = ChineseProcessor()
    
    test_words = [
        '红色',      # Red
        '蓝色',      # Blue
        '苹果',      # Apple
        '猫',        # Cat
        '狗',        # Dog
        '你好',      # Hello
        '谢谢',      # Thank you
    ]
    
    print("Chinese Processor Test")
    print("=" * 60)
    
    for word in test_words:
        result = processor.process_word(word)
        print(f"\nChinese: {result.native_text}")
        print(f"Pinyin: {result.pronunciation.get('pinyin', 'N/A')}")
        print(f"Devanagari: {result.devanagari}")
