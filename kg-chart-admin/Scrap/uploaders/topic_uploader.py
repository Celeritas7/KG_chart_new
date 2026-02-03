"""
Topic Uploader

Uploads topic translation data to Supabase.
This handles the kg_chart_topic_translations table which stores
per-language titles and descriptions for each topic.
"""

from typing import Dict, List, Optional
from supabase import create_client, Client

import sys
sys.path.append('..')

from config import SUPABASE_URL, SUPABASE_SERVICE_KEY, TABLES
from processors import get_processor


class TopicUploader:
    """
    Handles uploading topic translations to Supabase.
    
    Usage:
        uploader = TopicUploader()
        uploader.upload_topic_translation(
            topic_id='fruits',
            language_code='my',
            title_native='သစ်သီးများ',
            title_devanagari='थे?2दि3म्या3',
            question_english='What is your favorite fruit?',
            question_native='မင်းအကြိုက်ဆုံးအသီးကဘာလဲ။',
            question_devanagari='मिन3अ1चाइझों23अ1दि3ग1बा2ले³¹13।'
        )
    """
    
    def __init__(self):
        """Initialize the uploader with Supabase client."""
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        self.table = TABLES['topic_translations']
    
    def upload_topic_translation(
        self,
        topic_id: str,
        language_code: str,
        title_native: str,
        title_devanagari: str = '',
        question_english: str = '',
        question_native: str = '',
        question_devanagari: str = ''
    ) -> Dict:
        """
        Upload a single topic translation.
        
        Args:
            topic_id: Topic ID (e.g., 'fruits', 'animals')
            language_code: Language code (e.g., 'my', 'ja')
            title_native: Topic title in native script
            title_devanagari: Topic title in Devanagari
            question_english: Question in English
            question_native: Question in native script
            question_devanagari: Question in Devanagari
            
        Returns:
            Dict with upload result
        """
        data = {
            'topic_id': topic_id,
            'language_code': language_code,
            'title_native': title_native,
            'title_devanagari': title_devanagari,
            'question_english': question_english,
            'question_native': question_native,
            'question_devanagari': question_devanagari
        }
        
        # Upsert (insert or update on conflict)
        result = self.supabase.table(self.table).upsert(
            data,
            on_conflict='topic_id,language_code'
        ).execute()
        
        return {'success': True, 'data': result.data}
    
    def upload_bulk(self, translations: List[Dict]) -> Dict:
        """
        Upload multiple topic translations at once.
        
        Args:
            translations: List of translation dictionaries
            
        Returns:
            Dict with upload statistics
        """
        success = 0
        errors = []
        
        for trans in translations:
            try:
                self.upload_topic_translation(**trans)
                success += 1
            except Exception as e:
                errors.append({
                    'topic_id': trans.get('topic_id'),
                    'language_code': trans.get('language_code'),
                    'error': str(e)
                })
        
        return {
            'success': success,
            'errors': len(errors),
            'error_details': errors
        }


# Burmese topic translations from your data
BURMESE_TOPIC_TRANSLATIONS = [
    {
        'topic_id': 'colours',
        'language_code': 'my',
        'title_native': 'အရောင်များ',
        'title_devanagari': 'अ1यौं2म्या3',
        'question_english': 'What colour is this?',
        'question_native': 'ဒါကဘာအရောင်လဲ။',
        'question_devanagari': 'दा2ग1बा2अ1यौं2ले³¹13။'
    },
    {
        'topic_id': 'animals',
        'language_code': 'my',
        'title_native': 'တိရစ္ဆာန်များ',
        'title_devanagari': 'ति1य1स्साम्या3',
        'question_english': 'What is this animal?',
        'question_native': 'ဒီတိရစ္ဆာန်ကဘာလဲ။',
        'question_devanagari': 'दि2ति1य1स्साक1बा2ले³¹13။'
    },
    {
        'topic_id': 'food',
        'language_code': 'my',
        'title_native': 'အစားအသောက်',
        'title_devanagari': 'अ1झा3अ1दौ?1',
        'question_english': "I'll take it.",
        'question_native': 'အစားအသောက်',
        'question_devanagari': 'अ1झा3अ1दौ?1'
    },
    {
        'topic_id': 'vegetables',
        'language_code': 'my',
        'title_native': 'အသီးအရွက်',
        'title_devanagari': 'अ1दि3अ1य्वेत',
        'question_english': 'Do you have something you cannot eat?',
        'question_native': 'မင်း မစားနိုင်တဲ့ အရာ ရှိလား။',
        'question_devanagari': 'मिन3म1झा3नाइन2दे³¹111अ1या2शि1ला3။'
    },
    {
        'topic_id': 'fruits',
        'language_code': 'my',
        'title_native': 'သစ်သီးများ',
        'title_devanagari': 'थे?2दि3म्या3',
        'question_english': 'What is your favorite fruit?',
        'question_native': 'မင်းအကြိုက်ဆုံးအသီးကဘာလဲ။',
        'question_devanagari': 'मिन3अ1चाइझों23अ1दि3ग1बा2ले³¹13।'
    },
    {
        'topic_id': 'transportation',
        'language_code': 'my',
        'title_native': 'မိုဘိုင်း',
        'title_devanagari': 'मो2बाइन3',
        'question_english': 'Where should I go?',
        'question_native': 'ဘယ်သွားရမလဲ',
        'question_devanagari': 'बे³¹12थ्वा3य1म1ले³¹13'
    },
    {
        'topic_id': 'family',
        'language_code': 'my',
        'title_native': 'မိသားစု',
        'title_devanagari': 'मि1दा3झु1',
        'question_english': 'Who is it?',
        'question_native': 'ဘယ်သူလဲ?',
        'question_devanagari': 'बे³¹12दु2ले³¹111'
    },
    {
        'topic_id': 'body',
        'language_code': 'my',
        'title_native': 'ခန္ဓာကိုယ်',
        'title_devanagari': 'ख1न1',
        'question_english': 'Where does it hurt?',
        'question_native': 'ဘယ်နားကနာနေပါလဲ?',
        'question_devanagari': 'बे³¹12ना3ग1ना2ने2बा2ले³¹111'
    },
    {
        'topic_id': 'dates',
        'language_code': 'my',
        'title_native': 'ရက်စွဲ',
        'title_devanagari': 'येतस्वे³¹13',
        'question_english': 'What day is today?',
        'question_native': 'ဒီနေ့ဘာနေ့ပါလဲ?',
        'question_devanagari': 'दि2ने1बा2ने1बा2ले³¹111'
    },
    {
        'topic_id': 'weather',
        'language_code': 'my',
        'title_native': 'ရာသီဥတု',
        'title_devanagari': 'या2दि2उ1दु1',
        'question_english': 'How is the weather?',
        'question_native': 'ရာသီဥတု ဘယ်လိုလဲ။',
        'question_devanagari': 'या2दि2उ1दु1बे³¹12लो2ले³¹13।'
    },
    {
        'topic_id': 'drinks',
        'language_code': 'my',
        'title_native': 'သောက်ပါ။',
        'title_devanagari': 'थौ?1बा2।',
        'question_english': 'What would you like to drink?',
        'question_native': 'သင်ဘာသောက်ချင်ပါသလဲ?',
        'question_devanagari': 'थिन2बा2दौ?1छिन2बा2द1ले³¹111'
    },
    {
        'topic_id': 'sports',
        'language_code': 'my',
        'title_native': 'အားကစား',
        'title_devanagari': 'आ3ग1झा3',
        'question_english': 'Are you doing sports?',
        'question_native': 'မင်းအားကစားလုပ်နေတာလား။',
        'question_devanagari': 'मिन3आ3ग1झा3लोपने2दा2ला3।'
    },
    {
        'topic_id': 'hobby',
        'language_code': 'my',
        'title_native': 'ဝါသနာ',
        'title_devanagari': 'वा2द1ना2',
        'question_english': 'What is your hobby?',
        'question_native': 'မင်းရဲ့ဝါသနာကဘာလဲ',
        'question_devanagari': 'मिन3ये³¹111वा2द1ना2ग1बा2ले³¹13'
    },
    {
        'topic_id': 'tableware',
        'language_code': 'my',
        'title_native': 'ပန်းကန်ခွက်ယောက်',
        'title_devanagari': 'पं13गं12ख्वेतयौ?1',
        'question_english': '',
        'question_native': '',
        'question_devanagari': ''
    },
    {
        'topic_id': 'seasoning',
        'language_code': 'my',
        'title_native': 'ဟင်းခတ်အနှစ်',
        'title_devanagari': 'हिन3गत1अ1न्हे?2',
        'question_english': 'Could you please take?',
        'question_native': 'ကျေးဇူးပြုပြီး ယူလို့ရမလား။',
        'question_devanagari': 'चे3जु3प्यु1प्यि3यु2लो1य1म1ला3।'
    },
]


def upload_burmese_topics():
    """
    Upload all Burmese topic translations.
    """
    uploader = TopicUploader()
    result = uploader.upload_bulk(BURMESE_TOPIC_TRANSLATIONS)
    
    print("Upload Burmese Topic Translations")
    print("=" * 50)
    print(f"Success: {result['success']}")
    print(f"Errors: {result['errors']}")
    
    if result['error_details']:
        print("\nErrors:")
        for err in result['error_details']:
            print(f"  {err['topic_id']}: {err['error']}")
    
    return result


# Example usage
if __name__ == "__main__":
    upload_burmese_topics()
