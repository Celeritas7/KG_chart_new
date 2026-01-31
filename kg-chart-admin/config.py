# KG Chart Admin - Configuration
# Copy this file to .env and fill in your Supabase credentials

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://ulgrfumbwjovbjzjiems.supabase.co")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZ3JmdW1id2pvdmJqemppZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzIyNjcsImV4cCI6MjA4Mjk0ODI2N30.ix5Vh4Y3GXNbQbzVtTD_WSko0L3cr5q_eCnTuDEMh7M")

# Use service role key for admin operations (bypasses RLS)
# Get this from: Supabase Dashboard → Settings → API → service_role key
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "your-service-role-key")

# Storage Configuration
STORAGE_BUCKET = "vocabulary-assets"
IMAGE_BASE_PATH = "images"
AUDIO_BASE_PATH = "audio"

# Table names (with kg_chart_ prefix)
TABLES = {
    "languages": "kg_chart_languages",
    "topics": "kg_chart_topics",
    "topic_translations": "kg_chart_topic_translations",
    "vocabulary": "kg_chart_vocabulary",
    "vocabulary_translations": "kg_chart_vocabulary_translations",
    "user_ratings": "kg_chart_user_ratings",
    "quiz_sessions": "kg_chart_quiz_sessions",
    "quiz_answers": "kg_chart_quiz_answers",
}
