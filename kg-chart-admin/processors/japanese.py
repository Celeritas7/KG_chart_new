"""
Japanese Language Processor

Converts Japanese (Kanji/Hiragana/Katakana) to:
- Hiragana reading
- Romaji (Hepburn romanization)
- Devanagari transliteration (from Romaji)

Uses pykakasi library for Kanji → Hiragana/Romaji conversion.
"""

from typing import Dict, Any
from .base import LanguageProcessor, ProcessedWord

try:
    import pykakasi
    PYKAKASI_AVAILABLE = True
except ImportError:
    PYKAKASI_AVAILABLE = False
    print("Warning: pykakasi not installed. Run: pip install pykakasi")


# Romaji to Devanagari mapping for Japanese sounds
ROMAJI_TO_DEVANAGARI = {
    # Vowels (standalone)
    'a': 'अ', 'i': 'इ', 'u': 'उ', 'e': 'ए', 'o': 'ओ',
    
    # K-row
    'ka': 'का', 'ki': 'कि', 'ku': 'कु', 'ke': 'के', 'ko': 'को',
    'kya': 'क्या', 'kyu': 'क्यु', 'kyo': 'क्यो',
    
    # G-row (voiced K)
    'ga': 'गा', 'gi': 'गि', 'gu': 'गु', 'ge': 'गे', 'go': 'गो',
    'gya': 'ग्या', 'gyu': 'ग्यु', 'gyo': 'ग्यो',
    
    # S-row
    'sa': 'सा', 'si': 'सि', 'shi': 'शि', 'su': 'सु', 'se': 'से', 'so': 'सो',
    'sha': 'शा', 'shu': 'शु', 'sho': 'शो',
    
    # Z-row (voiced S)
    'za': 'ज़ा', 'zi': 'ज़ि', 'ji': 'जि', 'zu': 'ज़ु', 'ze': 'ज़े', 'zo': 'ज़ो',
    'ja': 'जा', 'ju': 'जु', 'jo': 'जो',
    
    # T-row
    'ta': 'ता', 'ti': 'ति', 'chi': 'चि', 'tu': 'तु', 'tsu': 'त्सु', 'te': 'ते', 'to': 'तो',
    'cha': 'चा', 'chu': 'चु', 'cho': 'चो',
    
    # D-row (voiced T)
    'da': 'दा', 'di': 'दि', 'du': 'दु', 'de': 'दे', 'do': 'दो',
    
    # N-row
    'na': 'ना', 'ni': 'नि', 'nu': 'नु', 'ne': 'ने', 'no': 'नो',
    'nya': 'न्या', 'nyu': 'न्यु', 'nyo': 'न्यो',
    'n': 'न्', 'nn': 'ん',  # Standalone N
    
    # H-row
    'ha': 'हा', 'hi': 'हि', 'hu': 'हु', 'fu': 'फु', 'he': 'हे', 'ho': 'हो',
    'hya': 'ह्या', 'hyu': 'ह्यु', 'hyo': 'ह्यो',
    
    # B-row (voiced H)
    'ba': 'बा', 'bi': 'बि', 'bu': 'बु', 'be': 'बे', 'bo': 'बो',
    'bya': 'ब्या', 'byu': 'ब्यु', 'byo': 'ब्यो',
    
    # P-row (half-voiced H)
    'pa': 'पा', 'pi': 'पि', 'pu': 'पु', 'pe': 'पे', 'po': 'पो',
    'pya': 'प्या', 'pyu': 'प्यु', 'pyo': 'प्यो',
    
    # M-row
    'ma': 'मा', 'mi': 'मि', 'mu': 'मु', 'me': 'मे', 'mo': 'मो',
    'mya': 'म्या', 'myu': 'म्यु', 'myo': 'म्यो',
    
    # Y-row
    'ya': 'या', 'yu': 'यु', 'yo': 'यो',
    
    # R-row
    'ra': 'रा', 'ri': 'रि', 'ru': 'रु', 're': 'रे', 'ro': 'रो',
    'rya': 'र्या', 'ryu': 'र्यु', 'ryo': 'र्यो',
    
    # W-row
    'wa': 'वा', 'wi': 'वि', 'we': 'वे', 'wo': 'वो',
    
    # Special sounds
    'fa': 'फा', 'fi': 'फि', 'fe': 'फे', 'fo': 'फो',
    'ti': 'ति', 'di': 'दि',
    'va': 'वा', 'vi': 'वि', 'vu': 'वु', 've': 'वे', 'vo': 'वो',
    
    # Long vowels (doubled)
    'aa': 'आ', 'ii': 'ई', 'uu': 'ऊ', 'ee': 'ए', 'oo': 'ओ',
    'ou': 'ओउ', 'ei': 'एइ',
    
    # Double consonants (gemination) - represented with small tsu
    'kk': 'क्क', 'ss': 'स्स', 'tt': 'त्त', 'pp': 'प्प',
    'cch': 'च्च', 'tch': 'त्च',
}


class JapaneseProcessor(LanguageProcessor):
    """
    Processor for Japanese language.
    
    Converts Kanji/Kana to:
    - Hiragana (for Japanese learners)
    - Romaji (Hepburn romanization)
    - Devanagari transliteration
    """
    
    def __init__(self):
        super().__init__(language_code='ja', language_name='Japanese')
        
        if PYKAKASI_AVAILABLE:
            self.kks = pykakasi.kakasi()
        else:
            self.kks = None
    
    def process_word(self, native_text: str, **kwargs) -> ProcessedWord:
        """
        Process a Japanese word.
        
        Args:
            native_text: Japanese text (Kanji, Hiragana, Katakana, or mixed)
            **kwargs: Optional pre-computed values
            
        Returns:
            ProcessedWord with all fields
        """
        # Generate pronunciation (Hiragana + Romaji)
        pronunciation = self.generate_pronunciation(native_text, **kwargs)
        
        # Generate Devanagari from Romaji
        romaji = pronunciation.get('romaji', '')
        devanagari = kwargs.get('devanagari') or self.generate_devanagari(native_text, romaji=romaji)
        
        return ProcessedWord(
            native_text=native_text,
            devanagari=devanagari,
            pronunciation=pronunciation,
            notes=kwargs.get('notes')
        )
    
    def generate_pronunciation(self, native_text: str, **kwargs) -> Dict[str, str]:
        """
        Generate Hiragana and Romaji from Japanese text.
        """
        # If both provided, use them
        if kwargs.get('hiragana') and kwargs.get('romaji'):
            return {
                'hiragana': kwargs['hiragana'],
                'romaji': kwargs['romaji']
            }
        
        # Use pykakasi to convert
        if self.kks is None:
            return {'hiragana': native_text, 'romaji': native_text}
        
        result = self.kks.convert(native_text)
        
        hiragana_parts = []
        romaji_parts = []
        
        for item in result:
            hiragana_parts.append(item['hira'])
            romaji_parts.append(item['hepburn'])
        
        return {
            'hiragana': ''.join(hiragana_parts),
            'romaji': ''.join(romaji_parts)
        }
    
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        """
        Generate Devanagari from Japanese text via Romaji.
        """
        if kwargs.get('devanagari'):
            return kwargs['devanagari']
        
        romaji = kwargs.get('romaji', '')
        
        if not romaji:
            pronunciation = self.generate_pronunciation(native_text)
            romaji = pronunciation.get('romaji', '')
        
        return self._romaji_to_devanagari(romaji)
    
    def _romaji_to_devanagari(self, romaji: str) -> str:
        """
        Convert Romaji to Devanagari.
        """
        if not romaji:
            return ''
        
        romaji = romaji.lower()
        result = []
        i = 0
        
        while i < len(romaji):
            matched = False
            
            # Try matching longer strings first (4, 3, 2, 1 chars)
            for length in [4, 3, 2, 1]:
                if i + length <= len(romaji):
                    chunk = romaji[i:i+length]
                    if chunk in ROMAJI_TO_DEVANAGARI:
                        result.append(ROMAJI_TO_DEVANAGARI[chunk])
                        i += length
                        matched = True
                        break
            
            if not matched:
                # Skip non-alpha or keep unmapped
                if romaji[i].isalpha():
                    result.append(romaji[i])
                i += 1
        
        return ''.join(result)
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from CSV data.
        
        Expected columns:
        - 'Japanese' or 'japanese' or 'kanji' or 'native_text': Japanese text
        - 'English' or 'english': English translation
        - 'hiragana' (optional): Pre-computed Hiragana
        - 'romaji' (optional): Pre-computed Romaji
        """
        native_text = (
            row.get('Japanese') or 
            row.get('japanese') or 
            row.get('kanji') or 
            row.get('native_text') or 
            row.get('Native') or
            ''
        )
        
        return self.process_word(
            native_text=native_text,
            hiragana=row.get('hiragana'),
            romaji=row.get('romaji'),
            devanagari=row.get('devanagari'),
            notes=row.get('notes')
        )


# Quick test
if __name__ == "__main__":
    processor = JapaneseProcessor()
    
    test_words = [
        '赤',        # Red (aka)
        '青',        # Blue (ao)
        '林檎',      # Apple (ringo)
        '猫',        # Cat (neko)
        '犬',        # Dog (inu)
        'こんにちは',  # Hello (konnichiwa)
        'ありがとう',  # Thank you (arigatou)
    ]
    
    print("Japanese Processor Test")
    print("=" * 60)
    
    for word in test_words:
        result = processor.process_word(word)
        print(f"\nJapanese: {result.native_text}")
        print(f"Hiragana: {result.pronunciation.get('hiragana', 'N/A')}")
        print(f"Romaji: {result.pronunciation.get('romaji', 'N/A')}")
        print(f"Devanagari: {result.devanagari}")
