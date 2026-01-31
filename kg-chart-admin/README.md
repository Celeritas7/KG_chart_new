# KG Chart Admin

Python tools for managing multi-language vocabulary data in Supabase.

## Project Structure

```
kg-chart-admin/
├── processors/              # Language-specific text processors
│   ├── __init__.py
│   ├── base.py              # Base LanguageProcessor class
│   ├── japanese.py          # Japanese (Kanji → Hiragana/Romaji → Devanagari)
│   ├── chinese.py           # Chinese (Hanzi → Pinyin → Devanagari)
│   └── burmese.py           # Burmese (uses pre-computed Devanagari from CSV)
├── uploaders/               # Data upload utilities
│   ├── __init__.py
│   ├── vocabulary_uploader.py
│   └── topic_uploader.py
├── data/                    # Your CSV/Excel files (create this folder)
│   └── burmese_kg_chart.csv
├── config.py                # Supabase configuration
├── main.py                  # CLI entry point
├── requirements.txt         # Python dependencies
├── .env.template            # Environment variables template
└── README.md
```

## Setup

### 1. Install Dependencies

```bash
cd kg-chart-admin
pip install -r requirements.txt
```

### 2. Configure Supabase

Copy the environment template and fill in your credentials:

```bash
cp .env.template .env
```

Edit `.env` with your Supabase credentials:
- `SUPABASE_URL`: Your project URL
- `SUPABASE_KEY`: Anon public key
- `SUPABASE_SERVICE_KEY`: Service role key (for admin operations)

Get these from: Supabase Dashboard → Settings → API

### 3. Create Database Tables

Run the SQL migration script in Supabase SQL Editor:
- Open Supabase Dashboard → SQL Editor
- Paste the migration script
- Click "Run"

## Usage

### Upload Topic Translations

First, upload the topic translations for your language:

```bash
python main.py upload-topics --language my
```

### Upload Vocabulary

Upload vocabulary from a CSV file:

```bash
# Dry run (validate without uploading)
python main.py upload-vocab data/burmese_fruits.csv --language my --topic fruits --dry-run

# Actual upload
python main.py upload-vocab data/burmese_fruits.csv --language my --topic fruits
```

### Test Processors

Test how a processor handles text:

```bash
# Japanese
python main.py test-processor ja "林檎"

# Chinese
python main.py test-processor zh "苹果"
```

### List Supported Languages

```bash
python main.py list-languages
```

## CSV Format

### Burmese CSV Structure

Your CSV should have these columns:

| Column | Description | Example |
|--------|-------------|---------|
| Burmese | Native Burmese text | ပန်းသီး |
| Intermediate | Devanagari transliteration | पं13दि3 |
| English | English translation | Apple |

### Japanese CSV Structure

| Column | Description | Example |
|--------|-------------|---------|
| japanese | Kanji/mixed text | 林檎 |
| hiragana | (optional) Hiragana reading | りんご |
| romaji | (optional) Romanization | ringo |
| english | English translation | Apple |

### Chinese CSV Structure

| Column | Description | Example |
|--------|-------------|---------|
| chinese | Hanzi characters | 苹果 |
| pinyin | (optional) Pinyin with tones | píngguǒ |
| english | English translation | Apple |

## Adding New Languages

1. Create a new processor in `processors/`:

```python
# processors/korean.py
from .base import LanguageProcessor, ProcessedWord

class KoreanProcessor(LanguageProcessor):
    def __init__(self):
        super().__init__(language_code='ko', language_name='Korean')
    
    def process_word(self, native_text: str, **kwargs) -> ProcessedWord:
        # Implement your logic
        pass
    
    def generate_devanagari(self, native_text: str, **kwargs) -> str:
        # Implement Devanagari conversion
        pass
    
    def generate_pronunciation(self, native_text: str, **kwargs) -> dict:
        # Return {"romaji": "..."}
        pass
```

2. Register in `processors/__init__.py`:

```python
from .korean import KoreanProcessor

PROCESSORS = {
    # ... existing
    'ko': KoreanProcessor,
}
```

3. Add topic translations in `uploaders/topic_uploader.py`

## Troubleshooting

### Import Errors

Make sure you're running from the `kg-chart-admin` directory:

```bash
cd kg-chart-admin
python main.py ...
```

### Supabase Connection Errors

1. Check your `.env` file has correct credentials
2. Make sure you're using the **service role key** (not anon key) for uploads
3. Verify RLS policies allow the operations

### Missing Dependencies

```bash
pip install pykakasi pypinyin supabase pandas python-dotenv tqdm
```

## License

MIT
