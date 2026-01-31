"""
Base Language Processor Class

This is the abstract base class that all language-specific processors inherit from.
Each language implements its own logic for generating Devanagari and pronunciation data.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class ProcessedWord:
    """
    Standardized output from any language processor.
    This structure matches the kg_chart_vocabulary_translations table.
    """
    native_text: str              # Original script: ပန်းသီး, 林檎, 苹果
    devanagari: str               # Universal Devanagari pronunciation
    pronunciation: Dict[str, str] # Language-specific: {"romaji": "...", "hiragana": "..."}
    notes: Optional[str] = None   # Any special notes


class LanguageProcessor(ABC):
    """
    Abstract base class for language-specific processing.
    
    Each language (Japanese, Burmese, Chinese, etc.) should have its own
    subclass that implements the abstract methods.
    """
    
    def __init__(self, language_code: str, language_name: str):
        self.language_code = language_code
        self.language_name = language_name
    
    @abstractmethod
    def process_word(self, native_text: str, **kwargs) -> ProcessedWord:
        """
        Process a single word and return standardized output.
        
        Args:
            native_text: The word in the native script
            **kwargs: Additional language-specific parameters
            
        Returns:
            ProcessedWord with all fields populated
        """
        pass
    
    @abstractmethod
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        """
        Generate Devanagari transliteration for the given text.
        
        Args:
            native_text: The word in the native script
            **kwargs: Additional parameters (e.g., intermediate romanization)
            
        Returns:
            Devanagari string
        """
        pass
    
    @abstractmethod
    def generate_pronunciation(self, native_text: str, **kwargs) -> Dict[str, str]:
        """
        Generate pronunciation aids specific to this language.
        
        Args:
            native_text: The word in the native script
            **kwargs: Additional parameters
            
        Returns:
            Dict with pronunciation data, e.g.:
            - Japanese: {"hiragana": "りんご", "romaji": "ringo"}
            - Chinese: {"pinyin": "píngguǒ"}
            - Burmese: {"romaji": "pan3thi3"}
        """
        pass
    
    def process_row(self, row: Dict[str, Any]) -> ProcessedWord:
        """
        Process a row from CSV/Excel data.
        
        Override this method if your CSV has a specific structure.
        Default implementation assumes a 'native_text' column exists.
        
        Args:
            row: Dictionary representing one row of data
            
        Returns:
            ProcessedWord with all fields populated
        """
        native_text = row.get('native_text', '')
        return self.process_word(native_text, row=row)
    
    def validate_output(self, word: ProcessedWord) -> bool:
        """
        Validate that the processed word has all required fields.
        
        Args:
            word: ProcessedWord to validate
            
        Returns:
            True if valid, raises ValueError if invalid
        """
        if not word.native_text:
            raise ValueError("native_text is required")
        if not word.devanagari:
            raise ValueError("devanagari is required")
        if not isinstance(word.pronunciation, dict):
            raise ValueError("pronunciation must be a dictionary")
        return True
    
    def __repr__(self):
        return f"{self.__class__.__name__}(code='{self.language_code}', name='{self.language_name}')"
