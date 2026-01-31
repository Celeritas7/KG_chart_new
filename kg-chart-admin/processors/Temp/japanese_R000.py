"""
Japanese Language Processor

Uses pykakasi library to convert:
- Kanji → Hiragana
- Kanji → Romaji

The Devanagari is generated from the Romaji using a mapping table.
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
    # Vowels
    'a': 'अ', 'i': 'इ', 'u': 'उ', 'e': 'ए', 'o': 'ओ',
    'aa': 'आ', 'ii': 'ई', 'uu': 'ऊ', 'ee': 'ई', 'oo': 'ओो',
    
    # K-row
    'ka': 'का', 'ki': 'कि', 'ku': 'कु', 'ke': 'के', 'ko': 'को',
    'kya': 'क्या', 'kyu': 'क्यु', 'kyo': 'क्यो',
    
    # G-row
    'ga': 'गा', 'gi': 'गि', 'gu': 'गु', 'ge': 'गे', 'go': 'गो',
    'gya': 'ग्या', 'gyu': 'ग्यु', 'gyo': 'ग्यो',
    
    # S-row
    'sa': 'सा', 'si': 'सि', 'shi': 'शि', 'su': 'सु', 'se': 'से', 'so': 'सो',
    'sha': 'शा', 'shu': 'शु', 'sho': 'शो',
    
    # Z-row
    'za': 'ज़ा', 'zi': 'ज़ि', 'ji': 'जि', 'zu': 'ज़ु', 'ze': 'ज़े', 'zo': 'ज़ो',
    'ja': 'जा', 'ju': 'जु', 'jo': 'जो',
    
    # T-row
    'ta': 'ता', 'ti': 'ति', 'chi': 'चि', 'tu': 'तु', 'tsu': 'त्सु', 'te': 'ते', 'to': 'तो',
    'cha': 'चा', 'chu': 'चु', 'cho': 'चो',
    
    # D-row
    'da': 'दा', 'di': 'दि', 'du': 'दु', 'de': 'दे', 'do': 'दो',
    
    # N-row
    'na': 'ना', 'ni': 'नि', 'nu': 'नु', 'ne': 'ने', 'no': 'नो',
    'nya': 'न्या', 'nyu': 'न्यु', 'nyo': 'न्यो',
    'n': 'न्', 'nn': 'न्',
    
    # H-row
    'ha': 'हा', 'hi': 'हि', 'hu': 'हु', 'fu': 'फु', 'he': 'हे', 'ho': 'हो',
    'hya': 'ह्या', 'hyu': 'ह्यु', 'hyo': 'ह्यो',
    
    # B-row
    'ba': 'बा', 'bi': 'बि', 'bu': 'बु', 'be': 'बे', 'bo': 'बो',
    'bya': 'ब्या', 'byu': 'ब्यु', 'byo': 'ब्यो',
    
    # P-row
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
    
    # Special
    'tt': 'त्', 'kk': 'क्', 'ss': 'स्', 'pp': 'प्',  # Double consonants
}


class JapaneseProcessor(LanguageProcessor):
    """
    Processor for Japanese language.
    
    Converts Kanji/mixed text to:
    - Hiragana (for Japanese learners)
    - Romaji (for beginners)
    - Devanagari (universal pronunciation)
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
            **kwargs: Optional 'hiragana' or 'romaji' if already known
            
        Returns:
            ProcessedWord with all fields
        """
        # Generate pronunciation data
        pronunciation = self.generate_pronunciation(native_text, **kwargs)
        
        # Generate Devanagari from romaji
        romaji = pronunciation.get('romaji', '')
        devanagari = self.generate_devanagari(native_text, romaji=romaji)
        
        return ProcessedWord(
            native_text=native_text,
            devanagari=devanagari,
            pronunciation=pronunciation,
            notes=kwargs.get('notes')
        )
    
    def generate_pronunciation(self, native_text: str, **kwargs) -> Dict[str, str]:
        """
        Generate Hiragana and Romaji from Japanese text.
        
        Args:
            native_text: Japanese text
            **kwargs: Optional pre-computed values
            
        Returns:
            {"hiragana": "...", "romaji": "..."}
        """
        # If values are provided in kwargs, use them
        if 'hiragana' in kwargs and 'romaji' in kwargs:
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
        Generate Devanagari from Japanese text.
        
        Uses Romaji as intermediate step, then maps to Devanagari.
        
        Args:
            native_text: Japanese text
            **kwargs: Optional 'romaji' if already computed
            
        Returns:
            Devanagari string
        """
        romaji = kwargs.get('romaji', '')
        
        if not romaji:
            pronunciation = self.generate_pronunciation(native_text)
            romaji = pronunciation.get('romaji', '')
        
        return self._romaji_to_devanagari(romaji)
    
    def _romaji_to_devanagari(self, romaji: str) -> str:
        """
        Convert Romaji to Devanagari using mapping table.
        
        Args:
            romaji: Romanized Japanese text
            
        Returns:
            Devanagari string
        """
        if not romaji:
            return ''
        
        romaji = romaji.lower()
        result = []
        i = 0
        
        while i < len(romaji):
            # Try matching 3 characters first, then 2, then 1
            matched = False
            
            for length in [3, 2, 1]:
                if i + length <= len(romaji):
                    chunk = romaji[i:i+length]
                    if chunk in ROMAJI_TO_DEVANAGARI:
                        result.append(ROMAJI_TO_DEVANAGARI[chunk])
                        i += length
                        matched = True
                        break
            
            if not matched:
                # Skip unknown characters (spaces, punctuation, etc.)
                if romaji[i].isalpha():
                    result.append(romaji[i])  # Keep as-is if no mapping
                i += 1
        
        return ''.join(result)
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from CSV/Excel data.
        
        Expected columns:
        - 'japanese' or 'native_text' or 'kanji': The Japanese text
        - 'hiragana' (optional): Pre-computed hiragana
        - 'romaji' (optional): Pre-computed romaji
        
        Args:
            row: Dictionary representing one row of data
            
        Returns:
            ProcessedWord
        """
        # Find the native text column
        native_text = (
            row.get('japanese') or 
            row.get('native_text') or 
            row.get('kanji') or 
            row.get('Native') or
            ''
        )
        
        return self.process_word(
            native_text=native_text,
            hiragana=row.get('hiragana'),
            romaji=row.get('romaji'),
            notes=row.get('notes')
        )


# Quick test
if __name__ == "__main__":
    processor = JapaneseProcessor()
    
    test_words = [
        "林檎",      # Apple (kanji)
        "りんご",    # Apple (hiragana)
        "猫",        # Cat
        "犬",        # Dog
        "水",        # Water
    ]
    
    print("Japanese Processor Test")
    print("=" * 50)
    
    for word in test_words:
        result = processor.process_word(word)
        print(f"\nInput: {word}")
        print(f"  Native: {result.native_text}")
        print(f"  Hiragana: {result.pronunciation.get('hiragana', 'N/A')}")
        print(f"  Romaji: {result.pronunciation.get('romaji', 'N/A')}")
        print(f"  Devanagari: {result.devanagari}")
