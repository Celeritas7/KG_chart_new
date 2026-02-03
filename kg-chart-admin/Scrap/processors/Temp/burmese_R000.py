"""
Burmese Language Processor

Uses custom mapping from your Excel/CSV structure.
Your CSV has columns:
- Burmese: Native Burmese script (e.g., ပန်းသီး)
- Intermediate/Marathi: Devanagari transliteration (e.g., पं13दि3)
- English: English translation

The Devanagari is already provided in your data, so this processor
mainly handles data extraction and romanization.
"""

from typing import Dict, Any
from .base import LanguageProcessor, ProcessedWord


# Burmese consonant to Romaji mapping (simplified)
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
    '်': '', '့': '1', 'း': '3', '္': '',
}

BURMESE_TO_DEVNAGARI = {
    # Consonants (K-Group, S-Group, T-Group, etc.)
    'က': 'क', 'ခ': 'ख', 'ဂ': 'ग', 'ဃ': 'घ', 'င': 'ङ',
    'စ': 'च', 'ဆ': 'छ', 'ဇ': 'ज', 'ဈ': 'झ', 'ည': 'ञ',
    'ဋ': 'ट', 'ဌ': 'ठ', 'ဍ': 'ड', 'ဎ': 'ढ', 'ဏ': 'ण',
    'တ': 'त', 'ထ': 'थ', 'ဒ': 'द', 'ဓ': 'ध', 'န': 'न',
    'ပ': 'प', 'ဖ': 'फ', 'ဗ': 'ब', 'ဘ': 'भ', 'မ': 'म',
    'ယ': 'य', 'ရ': 'र', 'လ': 'ल', 'ဝ': 'व',
    'သ': 'स', 'ဟ': 'ह', 'ဠ': 'ळ', 'အ': 'अ',
    
    # Medials (Subjoined)
    'ျ': '्य', 'ြ': '्र', 'ွ': '्व', 'ှ': '्ह',
    
    # Vowels (Matras)
    'ါ': 'ा', 'ာ': 'ा', 'ိ': 'ि', 'ီ': 'ी', 'ု': 'ु', 'ူ': 'ू',
    'ေ': 'े', 'ဲ': 'ै', 'ော': 'ो', 'ို': 'ो',
    
    # Finals (Virama/Halant applied to represent terminal sounds)
    'က်': 'क्', 'င်': 'ं', 'စ်': 'च्', 'ည်': 'ञ्',
    'တ်': 'त्', 'န်': 'न्', 'ပ်': 'प्', 'မ်': 'म्',
    'ယ်': 'य्', 'သ်': 'स्',
    
    # Tones and special
    '်': '्', '့': '़', 'း': 'ः', '္': '्',
}


class BurmeseProcessor(LanguageProcessor):
    """
    Processor for Burmese language.
    
    Your CSV structure provides Devanagari directly, so this processor:
    - Extracts native Burmese text
    - Uses provided Devanagari transliteration
    - Generates Romaji for pronunciation aid
    """
    
    def __init__(self):
        super().__init__(language_code='my', language_name='Burmese')
    
    def process_word(self, native_text: str, **kwargs) -> ProcessedWord:
        """
        Process a Burmese word.
        
        Args:
            native_text: Burmese script text
            **kwargs: 
                - 'devanagari': Pre-computed Devanagari from CSV
                - 'romaji': Pre-computed Romaji (optional)
            
        Returns:
            ProcessedWord with all fields
        """
        # Get Devanagari from kwargs (from your CSV 'Intermediate' column)
        devanagari = kwargs.get('devanagari', '')
        
        # If no Devanagari provided, try to generate (basic)
        if not devanagari:
            devanagari = self.generate_devanagari(native_text, **kwargs)
        
        # Generate pronunciation (Romaji)
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
        
        Args:
            native_text: Burmese script
            **kwargs: Optional pre-computed 'romaji'
            
        Returns:
            {"romaji": "..."}
        """
        # If romaji is provided, use it
        if 'romaji' in kwargs and kwargs['romaji']:
            return {'romaji': kwargs['romaji']}
        
        # Generate basic romaji
        romaji = self._burmese_to_romaji(native_text)
        
        return {'romaji': romaji}
    
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        """
        Generate Devanagari from Burmese text.
        
        Note: For Burmese, the Devanagari is typically provided in your CSV
        (the 'Intermediate' or 'Marathi' column). This method is a fallback.
        
        Args:
            native_text: Burmese script
            **kwargs: Optional pre-computed 'devanagari'
            
        Returns:
            Devanagari string
        """
        # If devanagari is provided, use it
        if 'devanagari' in kwargs and kwargs['devanagari']:
            return kwargs['devanagari']
        
        # Fallback: return placeholder (your CSV should have this)
        return f"[{native_text}]"
    
    def _burmese_to_romaji(self, text: str) -> str:
        """
        Convert Burmese script to basic Romaji.
        
        This is a simplified conversion. For accurate romanization,
        you may want to use the python-myanmar library or provide
        pre-computed romaji in your CSV.
        
        Args:
            text: Burmese text
            
        Returns:
            Romanized string
        """
        if not text:
            return ''
        
        result = []
        i = 0
        
        while i < len(text):
            # Try matching 2 characters first (for combined forms)
            matched = False
            
            if i + 1 < len(text):
                two_char = text[i:i+2]
                if two_char in BURMESE_TO_ROMAJI:
                    result.append(BURMESE_TO_ROMAJI[two_char])
                    i += 2
                    matched = True
            
            if not matched:
                char = text[i]
                if char in BURMESE_TO_ROMAJI:
                    result.append(BURMESE_TO_ROMAJI[char])
                else:
                    # Keep unknown characters as-is
                    if char.strip():
                        result.append(char)
                i += 1
        
        return ''.join(result)
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from your Burmese CSV data.
        
        Expected columns (based on your CSV structure):
        - 'Burmese' or 'burmese' or 'Native': Burmese script
        - 'Intermediate' or 'Marathi' or 'Devanagari': Devanagari transliteration
        - 'English' or 'english': English translation (not used here but available)
        
        Args:
            row: Dictionary representing one row of data
            
        Returns:
            ProcessedWord
        """
        # Find the Burmese text column
        native_text = (
            row.get('Burmese') or 
            row.get('burmese') or 
            row.get('native_text') or 
            row.get('Native') or
            ''
        )
        
        # Find the Devanagari column
        devanagari = (
            row.get('Intermediate') or
            row.get('Marathi') or
            row.get('Devanagari') or
            row.get('devanagari') or
            ''
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
    
    # Test with sample data matching your CSV structure
    test_rows = [
        {
            'Burmese': 'ပန်းသီး',
            'Intermediate': 'पं13दि3',
            'English': 'Apple'
        },
        {
            'Burmese': 'ခွေး',
            'Intermediate': 'ख्वे3',
            'English': 'Dog'
        },
        {
            'Burmese': 'ကြောင်',
            'Intermediate': 'चौं2',
            'English': 'Cat'
        },
    ]
    
    print("Burmese Processor Test")
    print("=" * 50)
    
    for row in test_rows:
        result = processor.process_row(row)
        print(f"\nInput: {row['Burmese']} ({row['English']})")
        print(f"  Native: {result.native_text}")
        print(f"  Devanagari: {result.devanagari}")
        print(f"  Romaji: {result.pronunciation.get('romaji', 'N/A')}")
