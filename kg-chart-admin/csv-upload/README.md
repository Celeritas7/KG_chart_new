# KG Chart - CSV Data Upload Guide

## Files Included

### 1. `1_topics.csv` - Topic Definitions (Upload FIRST)
Contains all 19 topics with:
- `topic_id` - Unique ID (colours, animals, food, etc.)
- `icon` - Emoji for display
- `sort_order` - Display order
- `image_filename` - Topic header image (optional)
- `title_english` - English title
- `title_native` - Burmese title
- `question_english` - English question
- `question_native` - Burmese question

### 2. `2_[topic].csv` - Vocabulary Files (Upload SECOND)
One file per topic containing:
- `english` - English word
- `native` - Burmese word  
- `image_filename` - Image file name
- `sort_order` - Display order
- `extra_data` - JSON for special data (e.g., color codes)

---

## Topics Summary

| # | Topic ID | Icon | Words |
|---|----------|------|-------|
| 1 | colours | 🎨 | 10 |
| 2 | animals | 🐾 | 13 |
| 3 | food | 🍔 | 19 |
| 4 | vegetables | 🥕 | 16 |
| 5 | fruits | 🍎 | 19 |
| 6 | transportation | 🚌 | 12 |
| 7 | shopping | 🛒 | 8 |
| 8 | hotel | 🏨 | 22 |
| 9 | body | 🧍 | 17 |
| 10 | date | 📅 | 7 |
| 11 | month | 📆 | 11 |
| 12 | season | 🌸 | 11 |
| 13 | family | 👨‍👩‍👧‍👦 | 13 |
| 14 | directions | 🧭 | 16 |
| 15 | hobby | 🎨 | 8 |
| 16 | tableware | 🍽️ | 9 |
| 17 | seasoning | 🧂 | 11 |
| 18 | sport | ⚽ | 12 |
| 19 | drink | 🥤 | 10 |

**Total: 234 vocabulary words**

---

## Upload Instructions

### Step 1: Insert Topics into Database

Run this SQL in Supabase SQL Editor for each topic:

```sql
-- Insert topic
INSERT INTO kg_chart_topics (topic_id, icon, sort_order, image_filename)
VALUES ('colours', '🎨', 1, 'colours.png')
ON CONFLICT (topic_id) DO UPDATE SET icon = EXCLUDED.icon;

-- Insert topic translation (Burmese)
INSERT INTO kg_chart_topic_translations 
(topic_id, language_code, title_native, question_english, question_native)
VALUES 
('colours', 'my', 'အရောင်များ', 'What colour is this?', 'ဒါကဘာအရောင်လဲ။')
ON CONFLICT (topic_id, language_code) DO UPDATE SET 
  title_native = EXCLUDED.title_native,
  question_english = EXCLUDED.question_english,
  question_native = EXCLUDED.question_native;
```

### Step 2: Insert Vocabulary into Database

For each vocabulary word:

```sql
-- Insert vocabulary
INSERT INTO kg_chart_vocabulary (topic_id, english_text, image_filename, sort_order, extra_data)
VALUES ('colours', 'Red', 'red.png', 1, '{"colorCode":"#FF0000"}')
RETURNING id;

-- Insert translation using the returned ID
INSERT INTO kg_chart_vocabulary_translations (vocabulary_id, language_code, native_text)
VALUES ('[returned-id]', 'my', 'အနီရောင်');
```

### Step 3: Upload Images to Supabase Storage

Create this folder structure in your `vocabulary-assets` bucket:

```
vocabulary-assets/
├── topics/           ← Topic header images
│   ├── colours.png
│   ├── animals.png
│   └── ...
├── colours/          ← Vocabulary images per topic
│   ├── red.png
│   ├── blue.png
│   └── ...
├── animals/
│   ├── dog.png
│   ├── cat.png
│   └── ...
└── ...
```

---

## Bulk Upload Script (Python)

For easier upload, use this Python script:

```python
import csv
from supabase import create_client

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Upload topics
with open('1_topics.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        # Insert topic
        supabase.table('kg_chart_topics').upsert({
            'topic_id': row['topic_id'],
            'icon': row['icon'],
            'sort_order': int(row['sort_order']),
            'image_filename': row['image_filename']
        }).execute()
        
        # Insert translation
        supabase.table('kg_chart_topic_translations').upsert({
            'topic_id': row['topic_id'],
            'language_code': 'my',
            'title_native': row['title_native'],
            'question_english': row['question_english'],
            'question_native': row['question_native']
        }).execute()

# Upload vocabulary for each topic
import glob
for vocab_file in glob.glob('2_*.csv'):
    topic_id = vocab_file.replace('2_', '').replace('.csv', '')
    with open(vocab_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Insert vocabulary
            result = supabase.table('kg_chart_vocabulary').upsert({
                'topic_id': topic_id,
                'english_text': row['english'],
                'image_filename': row['image_filename'],
                'sort_order': int(row['sort_order']),
                'extra_data': row['extra_data'] if row['extra_data'] else None
            }).execute()
            
            vocab_id = result.data[0]['id']
            
            # Insert translation
            supabase.table('kg_chart_vocabulary_translations').upsert({
                'vocabulary_id': vocab_id,
                'language_code': 'my',
                'native_text': row['native']
            }).execute()
```

---

## Adding New Languages

To add Japanese translations:

1. Create new vocabulary CSV files with Japanese column:
   ```csv
   english,native,image_filename,sort_order,extra_data
   Red,赤,red.png,1,{"colorCode":"#FF0000"}
   ```

2. Insert translations with `language_code = 'ja'`

3. Add `japanese.js` language file to app

The app will auto-generate Devanagari from the JS language mappings!

---

## Notes

- **Devanagari is NOT stored in database** - It's computed by the app using JS language files
- **Images are optional** - App shows placeholder if missing
- **extra_data** is only needed for colours (colorCode)
- **topic_id** must match folder names in Supabase Storage
