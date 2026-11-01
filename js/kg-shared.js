// KG Chart: code shared by the learner app (index.html) and admin (kg-chart-admin.html).
// Plain JS, no build step; loaded before each page's own script. Exposes window.KGShared.
// Change these here only: both pages (and kg_chart_rule_int() in kg-chart-rules.sql, for the rule limits) read them.
(function () {
  // ---- Rules (kg_chart_settings 'unlock_rules') ----
  // { min_attempts, quiz_types, level_up: { answers, pct }, languages: { my: { …any of these… } } }
  // A language's own value first, then the global one, then the default; whole numbers only, kept in range.
  const MCQ_QUIZ_TYPES = ['native_to_image', 'image_to_native', 'devanagari_to_image', 'english_to_native', 'listen_to_image', 'listen_to_native'];
  // Every quiz type a rule may name: the 6 multiple-choice ones, then the others that count toward word strength
  const RULE_QUIZ_TYPES = [...MCQ_QUIZ_TYPES, 'word_builder', 'type_word', 'typing_recall'];
  const RULE_DEFAULTS = { min_attempts: 1, quiz_types: MCQ_QUIZ_TYPES, level_up: { answers: 40, pct: 85 } };
  const RULE_LIMITS = { min_attempts: [1, 3], answers: [10, 200], pct: [50, 100] };

  // First whole number among the candidates (language, then global), kept in range; else the default
  const ruleInt = (cands, [lo, hi], d) => {
    const v = cands.find(x => typeof x === 'number' && Number.isInteger(x));
    return v === undefined ? d : Math.min(Math.max(v, lo), hi);
  };
  // The rules that apply to a language (languageCode null/undefined = the global rules), in the stored shape
  function resolveRules(value, languageCode) {
    const g = value && typeof value === 'object' ? value : {};
    const o = (languageCode && g.languages && typeof g.languages === 'object' && g.languages[languageCode]) || {};
    const typesOf = (v) => (Array.isArray(v) ? [...new Set(v.filter(t => RULE_QUIZ_TYPES.includes(t)))] : []);
    return {
      min_attempts: ruleInt([o.min_attempts, g.min_attempts], RULE_LIMITS.min_attempts, RULE_DEFAULTS.min_attempts),
      quiz_types: [typesOf(o.quiz_types), typesOf(g.quiz_types)].find(t => t.length) || RULE_DEFAULTS.quiz_types,
      level_up: {
        answers: ruleInt([o.level_up?.answers, g.level_up?.answers], RULE_LIMITS.answers, RULE_DEFAULTS.level_up.answers),
        pct: ruleInt([o.level_up?.pct, g.level_up?.pct], RULE_LIMITS.pct, RULE_DEFAULTS.level_up.pct),
      },
    };
  }

  // ---- Colour palette (Quiz → 🎨 Colours, admin → 🎨 Colour Phrases) ----
  // A colour word's English text → the colour the app paints. Others fall back to the word's extra_data.colorCode.
  const COLOUR_HEX = { Red: '#e53935', Blue: '#1e88e5', Green: '#43a047', Yellow: '#fdd835', Orange: '#fb8c00', Purple: '#8e24aa', Pink: '#f06292', Brown: '#795548', Black: '#262626', White: '#ececec' };
  // White things would vanish on the light tiles: give them a thin grey outline
  const COLOUR_OUTLINE = { White: 'drop-shadow(0 0 1px #64748b) drop-shadow(0 0 1px #64748b)' };

  // ---- "emoji:🌹" image filenames: the picture is drawn from the emoji on the device, nothing in storage ----
  const emojiCache = {};
  function emojiImageUrl(emoji) {
    if (emoji in emojiCache) return emojiCache[emoji];
    let url = null;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.font = '190px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(emoji, 128, 140);
      url = c.toDataURL('image/png');
    } catch (e) { url = null; }
    return (emojiCache[emoji] = url);
  }

  // ---- Meanings in another language ----
  // These languages show their meanings in a language other than English: Marathi words and sentences have
  // Filipino meanings (the fil translation rows and kg_chart_sentences.meaning_text). code = where the meanings are
  // stored, name = shown in the app and admin, short = the header's EN/FIL button. The only copy: app, admin and
  // review page all read it from here.
  const MEANING_LANGS = { mr: { code: 'fil', name: 'Filipino', short: 'FIL' } };

  // ---- Review list (kg-chart-review.html for reviewers, admin → 🧐 Reviews for progress) ----
  // MEANING_LANGS turned round: a Filipino reviewer checks the Filipino meanings of Marathi ({ fil: 'mr' })
  const REVIEW_MEANING_SOURCE = Object.fromEntries(Object.entries(MEANING_LANGS).map(([lang, m]) => [m.code, lang]));
  const reviewKey = (type, id, field) => `${type}|${id}|${field}`;
  // Every checkable text for one language: { key, type, id, field, text, meaning, context, contextLang, group, note, pic, topic }.
  // Rows can be for any languages; only `lang` (and its meaning source) are used. hiddenTopics / hiddenGroup leave
  // private lessons out (the review page does that for reviewers who aren't listed; admin counts everything).
  function reviewItems({ lang, vocabulary = [], vocabTrans = [], topics = [], topicTrans = [], sentences = [], hiddenTopics = new Set(), hiddenGroup = () => false }) {
    const L = lang, src = REVIEW_MEANING_SOURCE[L];
    const topicById = Object.fromEntries(topics.map(t => [t.id, t]));
    const tr = (rows, key, lc) => new Map(rows.filter(r => r.language_code === lc).map(r => [r[key], r]));
    const vMain = tr(vocabTrans, 'vocabulary_id', L), vSrc = src ? tr(vocabTrans, 'vocabulary_id', src) : new Map();
    const tMain = tr(topicTrans, 'topic_id', L), tSrc = src ? tr(topicTrans, 'topic_id', src) : new Map();
    const topicLabel = (id) => { const t = topicById[id]; return t ? `${t.icon || ''} ${tMain.get(id)?.title_native || t.name_english || t.title_english || id.replace(/_/g, ' ')}`.trim() : id; };
    const items = [];
    const add = (it) => items.push({ key: reviewKey(it.type, it.id, it.field), ...it });
    for (const v of vocabulary) {
      const t = vMain.get(v.id);
      if (!t || !t.native_text?.trim() || hiddenTopics.has(v.topic_id)) continue;
      add({ type: 'word', id: v.id, field: 'native_text', text: t.native_text.trim(), meaning: v.english_text,
        context: src ? vSrc.get(v.id)?.native_text : '', contextLang: src, group: topicLabel(v.topic_id), note: t.notes,
        pic: v.image_filename, topic: v.topic_id });
    }
    for (const tp of topics) {
      const t = tMain.get(tp.id);
      if (!t || hiddenTopics.has(tp.id)) continue;
      const s = tSrc.get(tp.id);
      if (t.title_native?.trim()) add({ type: 'topic', id: tp.id, field: 'title_native', text: t.title_native.trim(), meaning: `Topic: ${tp.id.replace(/_/g, ' ')}`, context: s?.title_native, contextLang: src, group: 'Topic titles' });
      if (t.question_native?.trim()) add({ type: 'topic', id: tp.id, field: 'question_native', text: t.question_native.trim(), meaning: t.question_english || s?.question_english || '', context: s?.question_native, contextLang: src, group: 'Topic questions' });
    }
    for (const s of sentences) {
      if (hiddenGroup(s)) continue;
      if (s.language_code === L && s.native_text?.trim()) add({ type: 'sentence', id: s.id, field: 'native_text', text: s.native_text.trim(), meaning: s.english_text, group: s.group_name || 'Sentences', note: s.notes && s.notes.length > 3 ? s.notes : '' });
      // Filipino reviewer: the Filipino meaning of each Marathi sentence
      if (src && s.language_code === src && s.meaning_text?.trim()) add({ type: 'sentence', id: s.id, field: 'meaning_text', text: s.meaning_text.trim(), meaning: s.english_text, context: s.native_text, contextLang: src, group: s.group_name || 'Sentences' });
    }
    return items;
  }

  window.KGShared = { MCQ_QUIZ_TYPES, RULE_QUIZ_TYPES, RULE_DEFAULTS, RULE_LIMITS, ruleInt, resolveRules, COLOUR_HEX, COLOUR_OUTLINE, emojiImageUrl,
    MEANING_LANGS, REVIEW_MEANING_SOURCE, reviewKey, reviewItems };
})();
