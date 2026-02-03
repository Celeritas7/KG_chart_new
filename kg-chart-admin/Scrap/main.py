"""
KG Chart Admin - Main Entry Point

This script provides a command-line interface for managing vocabulary data.

Usage:
    # Upload vocabulary from CSV
    python main.py upload-vocab data/burmese_fruits.csv --language my --topic fruits
    
    # Upload topic translations
    python main.py upload-topics --language my
    
    # Test a processor
    python main.py test-processor ja "林檎"
    
    # Dry run (validate without uploading)
    python main.py upload-vocab data/vocab.csv --language ja --topic fruits --dry-run
"""

import argparse
import sys

from processors import get_processor, list_supported_languages
from uploaders import VocabularyUploader, TopicUploader, upload_burmese_topics


def cmd_upload_vocab(args):
    """Upload vocabulary from CSV/Excel file."""
    print(f"Uploading vocabulary from: {args.file}")
    print(f"Language: {args.language}")
    print(f"Topic: {args.topic}")
    print(f"Dry run: {args.dry_run}")
    print()
    
    uploader = VocabularyUploader()
    
    # Column mapping based on language
    column_mapping = None
    if args.language == 'my':
        column_mapping = {
            'Burmese': 'native_text',
            'Intermediate': 'devanagari',
            'Marathi': 'devanagari',
            'English': 'english_text',
        }
    
    result = uploader.upload_from_csv(
        file_path=args.file,
        language_code=args.language,
        topic_id=args.topic,
        column_mapping=column_mapping,
        dry_run=args.dry_run
    )
    
    print("\n" + "=" * 50)
    print("Upload Summary:")
    print(f"  Processed: {result['processed']}")
    print(f"  Errors: {result['errors']}")
    print(f"  Uploaded: {result['uploaded']}")
    
    return result


def cmd_upload_topics(args):
    """Upload topic translations."""
    print(f"Uploading topic translations for: {args.language}")
    
    if args.language == 'my':
        result = upload_burmese_topics()
    else:
        print(f"No pre-defined topics for language: {args.language}")
        print("Please add topic data to uploaders/topic_uploader.py")
        return
    
    return result


def cmd_test_processor(args):
    """Test a language processor with sample text."""
    print(f"Testing processor for: {args.language}")
    print(f"Input text: {args.text}")
    print()
    
    try:
        processor = get_processor(args.language)
        result = processor.process_word(args.text)
        
        print("Results:")
        print(f"  Native text: {result.native_text}")
        print(f"  Devanagari: {result.devanagari}")
        print(f"  Pronunciation: {result.pronunciation}")
        if result.notes:
            print(f"  Notes: {result.notes}")
            
    except ValueError as e:
        print(f"Error: {e}")
        return


def cmd_list_languages(args):
    """List supported languages."""
    print("Supported Languages:")
    print("=" * 50)
    
    for code, processor_name in list_supported_languages().items():
        print(f"  {code}: {processor_name}")


def main():
    parser = argparse.ArgumentParser(
        description='KG Chart Admin - Vocabulary Management Tool',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Upload Burmese vocabulary
  python main.py upload-vocab data/burmese_fruits.csv -l my -t fruits
  
  # Test Japanese processor
  python main.py test-processor ja "林檎"
  
  # List supported languages
  python main.py list-languages
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Available commands')
    
    # Upload vocabulary command
    upload_vocab_parser = subparsers.add_parser(
        'upload-vocab', 
        help='Upload vocabulary from CSV/Excel file'
    )
    upload_vocab_parser.add_argument('file', help='Path to CSV or Excel file')
    upload_vocab_parser.add_argument(
        '-l', '--language', 
        required=True, 
        help='Language code (my, ja, zh)'
    )
    upload_vocab_parser.add_argument(
        '-t', '--topic', 
        required=True, 
        help='Topic ID (fruits, animals, etc.)'
    )
    upload_vocab_parser.add_argument(
        '-d', '--dry-run', 
        action='store_true', 
        help='Validate without uploading'
    )
    upload_vocab_parser.set_defaults(func=cmd_upload_vocab)
    
    # Upload topics command
    upload_topics_parser = subparsers.add_parser(
        'upload-topics', 
        help='Upload topic translations'
    )
    upload_topics_parser.add_argument(
        '-l', '--language', 
        required=True, 
        help='Language code (my, ja, zh)'
    )
    upload_topics_parser.set_defaults(func=cmd_upload_topics)
    
    # Test processor command
    test_parser = subparsers.add_parser(
        'test-processor', 
        help='Test a language processor'
    )
    test_parser.add_argument('language', help='Language code (my, ja, zh)')
    test_parser.add_argument('text', help='Text to process')
    test_parser.set_defaults(func=cmd_test_processor)
    
    # List languages command
    list_parser = subparsers.add_parser(
        'list-languages', 
        help='List supported languages'
    )
    list_parser.set_defaults(func=cmd_list_languages)
    
    # Parse arguments
    args = parser.parse_args()
    
    if args.command is None:
        parser.print_help()
        sys.exit(1)
    
    # Execute command
    args.func(args)


if __name__ == "__main__":
    main()
