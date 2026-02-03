"""
Chinese Language Processor

Uses pypinyin library to convert:
- Hanzi (Chinese characters) → Pinyin (with tone marks)

The Devanagari is generated from the Pinyin using a mapping table.
"""

from typing import Dict, Any
from .base import LanguageProcessor, ProcessedWord

try:
    from pypinyin import pinyin, Style
    PYPINYIN_AVAILABLE = True
except ImportError:
    PYPINYIN_AVAILABLE = False
    print("Warning: pypinyin not installed. Run: pip install pypinyin")


# Pinyin to Devanagari mapping for Chinese sounds
# Note: Tone marks in pinyin (ā á ǎ à) are preserved in output
PINYIN_TO_DEVANAGARI = {
    # Initials + Finals combinations
    # A finals
    'a': 'आ', 'ai': 'आइ', 'an': 'आन', 'ang': 'आंग', 'ao': 'आओ',
    
    # E finals
    'e': 'ए', 'ei': 'एइ', 'en': 'एन', 'eng': 'एंग', 'er': 'अर',
    
    # I finals
    'i': 'इ', 'ia': 'इया', 'ian': 'इयान', 'iang': 'इयांग', 'iao': 'इयाओ',
    'ie': 'इए', 'in': 'इन', 'ing': 'इंग', 'iong': 'इओंग', 'iu': 'इउ',
    
    # O finals
    'o': 'ओ', 'ong': 'ओंग', 'ou': 'ओउ',
    
    # U finals
    'u': 'उ', 'ua': 'उआ', 'uai': 'उआइ', 'uan': 'उआन', 'uang': 'उआंग',
    'ue': 'उए', 'ui': 'उइ', 'un': 'उन', 'uo': 'उओ',
    
    # Ü finals
    'ü': 'उ', 'üe': 'उए', 'üan': 'उआन', 'ün': 'उन',
    'v': 'उ', 've': 'उए', 'van': 'उआन', 'vn': 'उन',  # Alternative notation
    
    # Initials
    'b': 'ब', 'p': 'प', 'm': 'म', 'f': 'फ',
    'd': 'द', 't': 'त', 'n': 'न', 'l': 'ल',
    'g': 'ग', 'k': 'क', 'h': 'ह',
    'j': 'ज', 'q': 'च', 'x': 'श',
    'zh': 'झ', 'ch': 'छ', 'sh': 'श', 'r': 'र',
    'z': 'ज़', 'c': 'च', 's': 'स',
    'y': 'य', 'w': 'व',
    
    # Common syllables (for better accuracy)
    'ba': 'बा', 'bi': 'बी', 'bu': 'बु', 'bo': 'बो',
    'pa': 'पा', 'pi': 'पी', 'pu': 'पु', 'po': 'पो',
    'ma': 'मा', 'mi': 'मी', 'mu': 'मु', 'mo': 'मो',
    'fa': 'फ़ा', 'fu': 'फ़ु', 'fo': 'फ़ो',
    'da': 'दा', 'di': 'दी', 'du': 'दु', 'de': 'दे',
    'ta': 'ता', 'ti': 'ती', 'tu': 'तु', 'te': 'ते',
    'na': 'ना', 'ni': 'नी', 'nu': 'नु', 'ne': 'ने',
    'la': 'ला', 'li': 'ली', 'lu': 'लु', 'le': 'ले',
    'ga': 'गा', 'gu': 'गु', 'ge': 'गे',
    'ka': 'का', 'ku': 'कु', 'ke': 'के',
    'ha': 'हा', 'hu': 'हु', 'he': 'हे',
    'ji': 'जी', 'ju': 'जु',
    'qi': 'ची', 'qu': 'चु',
    'xi': 'शी', 'xu': 'शु',
    'zhi': 'झी', 'zhu': 'झु', 'zhe': 'झे',
    'chi': 'छी', 'chu': 'छु', 'che': 'छे',
    'shi': 'शी', 'shu': 'शु', 'she': 'शे',
    'ri': 'री', 'ru': 'रु', 're': 'रे',
    'zi': 'ज़ी', 'zu': 'ज़ु', 'ze': 'ज़े',
    'ci': 'ची', 'cu': 'चु', 'ce': 'चे',
    'si': 'सी', 'su': 'सु', 'se': 'से',
    'ya': 'या', 'yi': 'यी', 'yu': 'यु', 'ye': 'ये',
    'wa': 'वा', 'wu': 'वु', 'wo': 'वो', 'wei': 'वेइ',
    
    # Compound finals
    'ping': 'पिंग', 'guo': 'गुओ', 'hua': 'हुआ',
    'lin': 'लिन', 'ren': 'रेन', 'men': 'मेन',
    'shui': 'शुइ', 'niu': 'निउ', 'gou': 'गोउ',
}


class ChineseProcessor(LanguageProcessor):
    """
    Processor for Chinese (Mandarin) language.
    
    Converts Hanzi (Chinese characters) to:
    - Pinyin with tone marks
    - Devanagari (universal pronunciation)
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
        # Generate pronunciation data
        pronunciation = self.generate_pronunciation(native_text, **kwargs)
        
        # Generate Devanagari from pinyin
        pinyin_text = pronunciation.get('pinyin', '')
        devanagari = self.generate_devanagari(native_text, pinyin=pinyin_text)
        
        return ProcessedWord(
            native_text=native_text,
            devanagari=devanagari,
            pronunciation=pronunciation,
            notes=kwargs.get('notes')
        )
    
    def generate_pronunciation(self, native_text: str, **kwargs) -> Dict[str, str]:
        """
        Generate Pinyin from Chinese text.
        
        Args:
            native_text: Chinese characters
            **kwargs: Optional pre-computed 'pinyin'
            
        Returns:
            {"pinyin": "..."}
        """
        # If pinyin is provided, use it
        if 'pinyin' in kwargs and kwargs['pinyin']:
            return {'pinyin': kwargs['pinyin']}
        
        # Use pypinyin to convert
        if not PYPINYIN_AVAILABLE:
            return {'pinyin': native_text}
        
        # Get pinyin with tone marks
        result = pinyin(native_text, style=Style.TONE)
        pinyin_text = ''.join([item[0] for item in result])
        
        return {'pinyin': pinyin_text}
    
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        """
        Generate Devanagari from Chinese text.
        
        Uses Pinyin as intermediate step, then maps to Devanagari.
        
        Args:
            native_text: Chinese characters
            **kwargs: Optional 'pinyin' if already computed
            
        Returns:
            Devanagari string
        """
        pinyin_text = kwargs.get('pinyin', '')
        
        if not pinyin_text:
            pronunciation = self.generate_pronunciation(native_text)
            pinyin_text = pronunciation.get('pinyin', '')
        
        return self._pinyin_to_devanagari(pinyin_text)
    
    def _pinyin_to_devanagari(self, pinyin_text: str) -> str:
        """
        Convert Pinyin to Devanagari using mapping table.
        
        Args:
            pinyin_text: Pinyin with or without tone marks
            
        Returns:
            Devanagari string
        """
        if not pinyin_text:
            return ''
        
        # Remove tone marks for mapping (but we could keep them as superscript)
        clean_pinyin = self._remove_tone_marks(pinyin_text.lower())
        
        result = []
        i = 0
        
        while i < len(clean_pinyin):
            # Try matching longer strings first (4, 3, 2, 1 chars)
            matched = False
            
            for length in [4, 3, 2, 1]:
                if i + length <= len(clean_pinyin):
                    chunk = clean_pinyin[i:i+length]
                    if chunk in PINYIN_TO_DEVANAGARI:
                        result.append(PINYIN_TO_DEVANAGARI[chunk])
                        i += length
                        matched = True
                        break
            
            if not matched:
                # Skip unknown characters
                if clean_pinyin[i].isalpha():
                    result.append(clean_pinyin[i])
                i += 1
        
        return ''.join(result)
    
    def _remove_tone_marks(self, text: str) -> str:
        """
        Remove tone marks from pinyin for mapping lookup.
        
        Args:
            text: Pinyin text with tone marks
            
        Returns:
            Pinyin without tone marks
        """
        tone_map = {
            'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
            'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
            'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
            'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
            'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
            'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü',
        }
        
        result = []
        for char in text:
            result.append(tone_map.get(char, char))
        
        return ''.join(result)
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from CSV/Excel data.
        
        Expected columns:
        - 'chinese' or 'native_text' or 'hanzi': The Chinese text
        - 'pinyin' (optional): Pre-computed pinyin
        
        Args:
            row: Dictionary representing one row of data
            
        Returns:
            ProcessedWord
        """
        # Find the native text column
        native_text = (
            row.get('chinese') or 
            row.get('native_text') or 
            row.get('hanzi') or 
            row.get('Native') or
            ''
        )
        
        return self.process_word(
            native_text=native_text,
            pinyin=row.get('pinyin'),
            notes=row.get('notes')
        )


# Quick test
if __name__ == "__main__":
    processor = ChineseProcessor()
    
    test_words = [
        "苹果",    # Apple
        "猫",      # Cat
        "狗",      # Dog
        "水",      # Water
        "你好",    # Hello
    ]
    
    print("Chinese Processor Test")
    print("=" * 50)
    
    for word in test_words:
        result = processor.process_word(word)
        print(f"\nInput: {word}")
        print(f"  Native: {result.native_text}")
        print(f"  Pinyin: {result.pronunciation.get('pinyin', 'N/A')}")
        print(f"  Devanagari: {result.devanagari}")
