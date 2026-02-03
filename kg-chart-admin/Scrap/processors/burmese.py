"""
Burmese Language Processor

Converts Burmese script to:
- Devanagari transliteration (auto-generated)
- Romaji pronunciation

No need for pre-computed Devanagari in CSV - this processor generates it automatically.
"""

from typing import Dict, Any
from .base import LanguageProcessor, ProcessedWord


# Burmese to Romaji mapping
BURMESE_TO_ROMAJI = {
    # Consonants
    'က': 'k', 'ခ': 'kh', 'ဂ': 'g', 'ဃ': 'gh', 'င': 'ng',
    'စ': 's', 'ဆ': 'hs', 'ဇ': 'z', 'ဈ': 'zh', 'ည': 'ny',
    'ဋ': 't', 'ဌ': 'th', 'ဍ': 'd', 'ဎ': 'dh', 'ဏ': 'n',
    'တ': 't', 'ထ': 'th', 'ဒ': 'd', 'ဓ': 'dh', 'န': 'n',
    'ပ': 'p', 'ဖ': 'ph', 'ဗ': 'b', 'ဘ': 'bh', 'မ': 'm',
    'ယ': 'y', 'ရ': 'y', 'လ': 'l', 'ဝ': 'w',
    'သ': 'th', 'ဟ': 'h', 'ဠ': 'l', 'အ': 'a',
    
    # Medials
    'ျ': 'y', 'ြ': 'y', 'ွ': 'w', 'ှ': 'h',
    
    # Vowels
    'ါ': 'a', 'ာ': 'a', 'ိ': 'i', 'ီ': 'i', 'ု': 'u', 'ူ': 'u',
    'ေ': 'e', 'ဲ': 'e', 'ော': 'aw', 'ို': 'o',
    
    # Finals
    'က်': 'k', 'င်': 'in', 'စ်': 's', 'ည်': 'ny',
    'တ်': 't', 'န်': 'n', 'ပ်': 'p', 'မ်': 'm',
    'ယ်': 'y', 'သ်': 'th',
    
    # Tones and special
    '်': '', '့': '', 'း': '', '္': '',
}

# Burmese to Devanagari mapping
BURMESE_TO_DEVANAGARI = {
    # Consonants (K-Group)
    'က': 'क', 'ခ': 'ख', 'ဂ': 'ग', 'ဃ': 'घ', 'င': 'ङ', 'ငြ': 'ङ',

    # Consonants (S-Group)
    'ကျ': 'च', 'ကြ': 'च', 'ချ': 'छ', 'ခြ': 'छ', 'ဇ': 'ज', 'ဂျ': 'ज', 'ဈ': 'झ', 'ဂြ': 'झ', 'ဉ ': 'ञ', 'ည': 'ञ',
    
    # Consonants (T-Group retroflex)
    'ဋ': 'ट', 'ဌ': 'ठ', 'ဍ': 'ड', 'ဎ': 'ढ', 'ဏ': 'ण',
    
    # Consonants (T-Group dental)
    'တ': 'त', 'ထ': 'थ', 'သ': 'थ', 'ဒ': 'द', 'ဓ': 'ध', 'န': 'न',
    
    # Consonants (P-Group)
    'ပ': 'प', 'ဖ': 'फ', 'ဗ': 'ब', 'ဘ': 'भ', 'မ': 'म',
    
    # Consonants (Semi-vowels and others)
    'ယ': 'य', 'ရ': 'र', 'လ': 'ल', 'ဝ': 'व', 'ရှ': 'श', 'စ': 'स', 'ဿ': 'स्स', 'ဆ': 'स',
    'ဟ': 'ह', 'ဠ': 'ळ',
    'အ': 'अ',



    # Medials (Subjoined consonants)
    'ျ': '्य', 'ြ': '्य', 'ွ': '्व', 'ှ': '्ह',
    
    # Vowels (Matras/Dependent vowels)
    'ါ': 'ा', 'ာ': 'ा', 'ိ': 'ि', 'ီ': 'ी', 'ု': 'ु', 'ူ': 'ू',
    'ေ': 'े', 'ဲ': 'ै', 'ော': 'ो', 'ို': 'ो',
    
    # Finals with Virama (Halant)
    'က်': 'क्', 'င်': 'ं', 'င်္': 'ं', 'စ်': 'च्', 'ည်': 'ञ्',
    'တ်': 'त्', 'န်': 'न्', 'ပ်': 'प्', 'မ်': 'म्',
    'ယ်': 'य्', 'သ်': 'स्',
    
    # Tones and special markers
    '်': '्',      # Virama/Halant
    '့': '॰',      # Light tone marker
    'း': 'ः',      # Visarga (heavy tone)
    '္': '्',      # Stacked consonant marker
}


class BurmeseProcessor(LanguageProcessor):
    """
    Processor for Burmese language.
    
    Automatically generates:
    - Devanagari transliteration from Burmese script
    - Romaji pronunciation
    
    CSV only needs 'Burmese' and 'English' columns.
    """
    
    def __init__(self):
        super().__init__(language_code='my', language_name='Burmese')
    
    def process_word(self, native_text: str, **kwargs) -> ProcessedWord:
        """
        Process a Burmese word.
        
        Args:
            native_text: Burmese script text
            **kwargs: Optional overrides
            
        Returns:
            ProcessedWord with all fields
        """
        # Generate Devanagari (or use provided if exists)
        devanagari = kwargs.get('devanagari') or self.generate_devanagari(native_text)
        
        # Generate pronunciation
        pronunciation = self.generate_pronunciation(native_text, **kwargs)
        
        return ProcessedWord(
            native_text=native_text,
            devanagari=devanagari,
            pronunciation=pronunciation,
            notes=kwargs.get('notes')
        )
    
    def generate_pronunciation(self, native_text: str, **kwargs) -> Dict[str, str]:
        """
        Generate Romaji from Burmese text.
        """
        if kwargs.get('romaji'):
            return {'romaji': kwargs['romaji']}
        
        romaji = self._convert_text(native_text, BURMESE_TO_ROMAJI)
        return {'romaji': romaji}
    
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        """
        Generate Devanagari from Burmese text.
        """
        if kwargs.get('devanagari'):
            return kwargs['devanagari']
        
        return self._convert_text(native_text, BURMESE_TO_DEVANAGARI)
    
    def _convert_text(self, text: str, mapping: Dict[str, str]) -> str:
        """
        Convert text using a character mapping.
        
        Handles multi-character sequences (2-char first, then 1-char).
        
        Args:
            text: Input text
            mapping: Character mapping dictionary
            
        Returns:
            Converted string
        """
        if not text:
            return ''
        
        result = []
        i = 0
        
        while i < len(text):
            matched = False
            
            # Try 3-character match first (for complex sequences)
            if i + 2 < len(text):
                three_char = text[i:i+3]
                if three_char in mapping:
                    result.append(mapping[three_char])
                    i += 3
                    matched = True
            
            # Try 2-character match
            if not matched and i + 1 < len(text):
                two_char = text[i:i+2]
                if two_char in mapping:
                    result.append(mapping[two_char])
                    i += 2
                    matched = True
            
            # Try 1-character match
            if not matched:
                char = text[i]
                if char in mapping:
                    result.append(mapping[char])
                elif char.strip():
                    # Keep unmapped non-whitespace characters
                    result.append(char)
                i += 1
        
        return ''.join(result)
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from CSV data.
        
        Expected columns:
        - 'Burmese' or 'burmese' or 'native_text': Burmese script
        - 'English' or 'english': English translation (handled by uploader)
        - 'Intermediate' or 'Marathi' (optional): Pre-computed Devanagari
        
        Args:
            row: Dictionary representing one row of data
            
        Returns:
            ProcessedWord
        """
        # Find Burmese text
        native_text = (
            row.get('Burmese') or 
            row.get('burmese') or 
            row.get('native_text') or 
            row.get('Native') or
            ''
        )
        
        # Find optional pre-computed Devanagari
        devanagari = (
            row.get('Intermediate') or
            row.get('Marathi') or
            row.get('Marathi (Intermediate)') or
            row.get('Devanagari') or
            row.get('devanagari') or
            None  # Will auto-generate if None
        )
        
        return self.process_word(
            native_text=native_text,
            devanagari=devanagari,
            romaji=row.get('romaji'),
            notes=row.get('notes')
        )


# Quick test
if __name__ == "__main__":
    processor = BurmeseProcessor()
    
    test_words = [
        'အနီရောင်',      # Red
        'အပြာရောင်',     # Blue
        'အဝါရောင်',      # Yellow
        'အစိမ်းရောင်',    # Green
        'ပန်းသီး',       # Apple
        'ခွေး',          # Dog
        'ကြောင်',        # Cat
    ]
    
    print("Burmese Processor Test")
    print("=" * 60)
    
    for word in test_words:
        result = processor.process_word(word)
        print(f"\nBurmese: {result.native_text}")
        print(f"Devanagari: {result.devanagari}")
        print(f"Romaji: {result.pronunciation.get('romaji', 'N/A')}")
