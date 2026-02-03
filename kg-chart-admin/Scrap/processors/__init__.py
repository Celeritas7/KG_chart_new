"""
Language Processors Package

Provides language-specific processors for generating:
- Native text handling
- Devanagari transliteration (auto-generated)
- Pronunciation aids (Romaji, Hiragana, Pinyin, etc.)

Usage:
    from processors import get_processor
    
    # Burmese - auto-generates Devanagari from Burmese script
    processor = get_processor('my')
    result = processor.process_word('အနီရောင်')
    
    # Japanese - auto-generates Devanagari from Romaji
    processor = get_processor('ja')
    result = processor.process_word('林檎')
    
    # Chinese - auto-generates Devanagari from Pinyin
    processor = get_processor('zh')
    result = processor.process_word('苹果')
"""

from .base import LanguageProcessor, ProcessedWord
from .japanese import JapaneseProcessor
from .chinese import ChineseProcessor
from .burmese import BurmeseProcessor

# Registry of available processors
PROCESSORS = {
    'ja': JapaneseProcessor,
    'zh': ChineseProcessor,
    'my': BurmeseProcessor,
    # Add more languages here:
    # 'te': TeluguProcessor,
    # 'ko': KoreanProcessor,
}


def get_processor(language_code: str) -> LanguageProcessor:
    """
    Factory function to get the appropriate processor for a language.
    
    Args:
        language_code: ISO 639-1 language code (e.g., 'ja', 'zh', 'my')
        
    Returns:
        LanguageProcessor instance for the specified language
        
    Raises:
        ValueError: If the language code is not supported
    """
    if language_code not in PROCESSORS:
        supported = ', '.join(PROCESSORS.keys())
        raise ValueError(
            f"Unsupported language code: '{language_code}'. "
            f"Supported languages: {supported}"
        )
    
    return PROCESSORS[language_code]()


def list_supported_languages() -> dict:
    """
    Get a dictionary of all supported languages.
    
    Returns:
        Dict mapping language codes to processor class names
    """
    return {
        code: cls.__name__ 
        for code, cls in PROCESSORS.items()
    }


__all__ = [
    'LanguageProcessor',
    'ProcessedWord',
    'JapaneseProcessor',
    'ChineseProcessor',
    'BurmeseProcessor',
    'get_processor',
    'list_supported_languages',
]
