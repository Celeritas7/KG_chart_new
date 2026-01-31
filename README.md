# KG Chart - Multi-Language Vocabulary Learning App

A React application for learning vocabulary across multiple languages with Devanagari transliteration, powered by Supabase.

## Features

- 📊 **Chart View**: Browse vocabulary by topic with visual cards
- 🎯 **Quiz Mode**: Test your knowledge with 4 different quiz types
- 🃏 **Flashcards**: Study with flip cards and spaced repetition
- 📈 **Progress Tracking**: Monitor your learning progress
- 🔐 **User Authentication**: Save progress across devices
- 🌐 **Multi-Language**: Support for Burmese, Japanese, Chinese, and more

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account with database set up

## Setup

### 1. Clone and Install

```bash
cd kg-chart-app
npm install
```

### 2. Configure Supabase

Copy the environment template:
```bash
cp .env.example .env
```

Edit `.env` with your Supabase credentials:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run Development Server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### 4. Build for Production

```bash
npm run build
```

The built files will be in the `dist` folder.

## Project Structure

```
src/
├── components/
│   ├── Header.jsx          # Navigation and auth
│   ├── TopicNav.jsx        # Topic selection tabs
│   ├── ChartView.jsx       # Vocabulary grid view
│   ├── QuizView.jsx        # Quiz mode
│   ├── FlashcardView.jsx   # Flashcard study
│   ├── ProgressView.jsx    # Progress statistics
│   └── LoadingSpinner.jsx  # Loading indicator
├── contexts/
│   └── AuthContext.jsx     # Authentication provider
├── hooks/
│   └── useSupabase.js      # Data fetching hooks
├── lib/
│   ├── supabase.js         # Supabase client
│   └── constants.js        # App constants
├── App.jsx                 # Main app component
├── main.jsx                # Entry point
└── index.css               # Global styles
```

## Database Requirements

This app requires the following Supabase tables (with `kg_chart_` prefix):

- `kg_chart_languages` - Language definitions
- `kg_chart_topics` - Topic categories
- `kg_chart_topic_translations` - Topic titles per language
- `kg_chart_vocabulary` - Master vocabulary list
- `kg_chart_vocabulary_translations` - Per-language translations
- `kg_chart_user_ratings` - User progress/ratings
- `kg_chart_quiz_sessions` - Quiz history
- `kg_chart_quiz_answers` - Quiz answer details

Run the SQL migration script to create these tables.

## Authentication

The app supports:
- Email/Password sign up and sign in
- Google OAuth (requires Supabase configuration)

Without authentication, users can browse vocabulary but cannot save progress.

## Customization

### Adding Languages

1. Add language to `kg_chart_languages` table
2. Add topic translations to `kg_chart_topic_translations`
3. Add vocabulary translations to `kg_chart_vocabulary_translations`

### Styling

- Tailwind CSS for styling
- Custom fonts configured in `tailwind.config.js`
- Global styles in `src/index.css`

## Deployment

### GitHub Pages

1. Update `vite.config.js` base path:
```js
export default defineConfig({
  base: '/your-repo-name/',
  // ...
})
```

2. Build and deploy:
```bash
npm run build
# Deploy dist folder to gh-pages branch
```

### Vercel/Netlify

1. Connect your repository
2. Set environment variables in dashboard
3. Deploy

## License

MIT
