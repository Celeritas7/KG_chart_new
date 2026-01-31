"""
Vocabulary Uploader

Uploads vocabulary data from CSV/Excel files to Supabase.
Handles the complete workflow:
1. Read CSV/Excel file
2. Process each row through the appropriate language processor
3. Upload to kg_chart_vocabulary and kg_chart_vocabulary_translations tables
"""

import pandas as pd
from typing import List, Dict, Any, Optional
from dataclasses import dataclass
from tqdm import tqdm

from supabase import create_client, Client

import sys
sys.path.append('..')

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, TABLES
from processors import get_processor, ProcessedWord


@dataclass
class VocabularyItem:
    """Represents a vocabulary item ready for upload."""
    english_text: str
    topic_id: str
    image_filename: str
    sort_order: int
    extra_data: Dict[str, Any]
    
    # Translation data
    language_code: str
    native_text: str
    devanagari: str
    pronunciation: Dict[str, str]
    audio_url: Optional[str] = None
    notes: Optional[str] = None


class VocabularyUploader:
    """
    Handles uploading vocabulary data to Supabase.
    
    Usage:
        uploader = VocabularyUploader()
        uploader.upload_from_csv('data/burmese_kg_chart.csv', language_code='my')
    """
    
    def __init__(self):
        """Initialize the uploader with Supabase client."""
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        self.vocab_table = TABLES['vocabulary']
        self.trans_table = TABLES['vocabulary_translations']
    
    def upload_from_csv(
        self, 
        file_path: str, 
        language_code: str,
        topic_id: str,
        column_mapping: Optional[Dict[str, str]] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Upload vocabulary from a CSV file.
        
        Args:
            file_path: Path to CSV or Excel file
            language_code: Language code (e.g., 'my', 'ja', 'zh')
            topic_id: Topic ID (e.g., 'fruits', 'animals')
            column_mapping: Optional dict mapping CSV columns to expected names
                Example: {'Burmese': 'native_text', 'Marathi': 'devanagari'}
            dry_run: If True, only validate without uploading
            
        Returns:
            Dict with upload statistics
        """
        # Read file
        if file_path.endswith('.xlsx') or file_path.endswith('.xls'):
            df = pd.read_excel(file_path)
        else:
            df = pd.read_csv(file_path)
        
        print(f"Loaded {len(df)} rows from {file_path}")
        print(f"Columns: {list(df.columns)}")
        
        # Apply column mapping if provided
        if column_mapping:
            df = df.rename(columns=column_mapping)
        
        # Get the appropriate processor
        processor = get_processor(language_code)
        print(f"Using processor: {processor}")
        
        # Process each row
        items = []
        errors = []
        
        for idx, row in tqdm(df.iterrows(), total=len(df), desc="Processing"):
            try:
                item = self._process_row(
                    row=row.to_dict(),
                    processor=processor,
                    topic_id=topic_id,
                    language_code=language_code,
                    sort_order=idx + 1
                )
                items.append(item)
            except Exception as e:
                errors.append({
                    'row': idx,
                    'error': str(e),
                    'data': row.to_dict()
                })
        
        print(f"\nProcessed: {len(items)} items")
        print(f"Errors: {len(errors)}")
        
        if errors:
            print("\nFirst 5 errors:")
            for err in errors[:5]:
                print(f"  Row {err['row']}: {err['error']}")
        
        if dry_run:
            print("\n[DRY RUN] No data uploaded.")
            return {
                'processed': len(items),
                'errors': len(errors),
                'uploaded': 0,
                'items': items[:5]  # Return first 5 for preview
            }
        
        # Upload to Supabase
        uploaded = self._upload_items(items)
        
        return {
            'processed': len(items),
            'errors': len(errors),
            'uploaded': uploaded,
            'error_details': errors
        }
    
    def _process_row(
        self,
        row: Dict[str, Any],
        processor,
        topic_id: str,
        language_code: str,
        sort_order: int
    ) -> VocabularyItem:
        """
        Process a single row from the CSV.
        
        Args:
            row: Dictionary of row data
            processor: LanguageProcessor instance
            topic_id: Topic ID
            language_code: Language code
            sort_order: Sort order for this item
            
        Returns:
            VocabularyItem ready for upload
        """
        # Get English text (required)
        english_text = (
            row.get('English') or 
            row.get('english') or 
            row.get('english_text') or
            ''
        ).strip()
        
        if not english_text:
            raise ValueError("English text is required")
        
        # Process through language processor
        processed: ProcessedWord = processor.process_row(row)
        
        # Generate image filename from English text
        image_filename = self._generate_image_filename(english_text)
        
        # Handle extra_data (e.g., colorCode for colours topic)
        extra_data = {}
        if 'colorCode' in row:
            extra_data['colorCode'] = row['colorCode']
        elif 'color_code' in row:
            extra_data['colorCode'] = row['color_code']
        
        return VocabularyItem(
            english_text=english_text,
            topic_id=topic_id,
            image_filename=image_filename,
            sort_order=sort_order,
            extra_data=extra_data,
            language_code=language_code,
            native_text=processed.native_text,
            devanagari=processed.devanagari,
            pronunciation=processed.pronunciation,
            audio_url=row.get('audio_url'),
            notes=processed.notes or row.get('notes')
        )
    
    def _generate_image_filename(self, english_text: str) -> str:
        """
        Generate image filename from English text.
        
        Args:
            english_text: English word (e.g., "French fries")
            
        Returns:
            Filename (e.g., "french-fries.png")
        """
        # Convert to lowercase, replace spaces with hyphens
        filename = english_text.lower().strip()
        filename = filename.replace(' ', '-')
        filename = filename.replace('_', '-')
        
        # Remove special characters
        filename = ''.join(c for c in filename if c.isalnum() or c == '-')
        
        return f"{filename}.jpg"
    
    def _upload_items(self, items: List[VocabularyItem]) -> int:
        """
        Upload items to Supabase.
        
        This method:
        1. Checks if vocabulary item exists (by english_text + topic_id)
        2. Creates new vocabulary item if not exists
        3. Upserts the translation for the language
        
        Args:
            items: List of VocabularyItem to upload
            
        Returns:
            Number of items uploaded
        """
        uploaded = 0
        
        for item in tqdm(items, desc="Uploading"):
            try:
                # Check if vocabulary item exists
                vocab_id = self._get_or_create_vocabulary(item)
                
                # Upsert translation
                self._upsert_translation(vocab_id, item)
                
                uploaded += 1
                
            except Exception as e:
                print(f"Error uploading '{item.english_text}': {e}")
        
        return uploaded
    
    def _get_or_create_vocabulary(self, item: VocabularyItem) -> str:
        """
        Get existing vocabulary ID or create new one.
        
        Args:
            item: VocabularyItem
            
        Returns:
            UUID of the vocabulary item
        """
        # Check if exists
        result = self.supabase.table(self.vocab_table).select('id').eq(
            'english_text', item.english_text
        ).eq(
            'topic_id', item.topic_id
        ).execute()
        
        if result.data:
            return result.data[0]['id']
        
        # Create new
        new_vocab = {
            'english_text': item.english_text,
            'topic_id': item.topic_id,
            'image_filename': item.image_filename,
            'sort_order': item.sort_order,
            'extra_data': item.extra_data or {}
        }
        
        result = self.supabase.table(self.vocab_table).insert(new_vocab).execute()
        
        return result.data[0]['id']
    
    def _upsert_translation(self, vocab_id: str, item: VocabularyItem):
        """
        Insert or update translation for a vocabulary item.
        
        Args:
            vocab_id: UUID of the vocabulary item
            item: VocabularyItem with translation data
        """
        translation = {
            'vocabulary_id': vocab_id,
            'language_code': item.language_code,
            'native_text': item.native_text,
            'devanagari': item.devanagari,
            'pronunciation': item.pronunciation,
            'audio_url': item.audio_url,
            'notes': item.notes
        }
        
        # Upsert (insert or update on conflict)
        self.supabase.table(self.trans_table).upsert(
            translation,
            on_conflict='vocabulary_id,language_code'
        ).execute()


def upload_burmese_csv(file_path: str, topic_id: str, dry_run: bool = True):
    """
    Convenience function to upload Burmese vocabulary.
    
    Args:
        file_path: Path to CSV file
        topic_id: Topic ID (e.g., 'fruits')
        dry_run: If True, only validate without uploading
    """
    uploader = VocabularyUploader()
    
    # Column mapping for your Burmese CSV structure
    column_mapping = {
        'Burmese': 'native_text',
        'Intermediate': 'devanagari',
        'Marathi': 'devanagari',  # Alternative column name
        'English': 'english_text',
    }
    
    result = uploader.upload_from_csv(
        file_path=file_path,
        language_code='my',
        topic_id=topic_id,
        column_mapping=column_mapping,
        dry_run=dry_run
    )
    
    return result


# Example usage
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Upload vocabulary to Supabase')
    parser.add_argument('file', help='CSV or Excel file path')
    parser.add_argument('--language', '-l', required=True, help='Language code (my, ja, zh)')
    parser.add_argument('--topic', '-t', required=True, help='Topic ID (fruits, animals, etc.)')
    parser.add_argument('--dry-run', '-d', action='store_true', help='Validate without uploading')
    
    args = parser.parse_args()
    
    uploader = VocabularyUploader()
    result = uploader.upload_from_csv(
        file_path=args.file,
        language_code=args.language,
        topic_id=args.topic,
        dry_run=args.dry_run
    )
    
    print("\n" + "=" * 50)
    print("Upload Summary:")
    print(f"  Processed: {result['processed']}")
    print(f"  Errors: {result['errors']}")
    print(f"  Uploaded: {result['uploaded']}")
