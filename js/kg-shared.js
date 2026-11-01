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

  window.KGShared = { MCQ_QUIZ_TYPES, RULE_QUIZ_TYPES, RULE_DEFAULTS, RULE_LIMITS, ruleInt, resolveRules, COLOUR_HEX, COLOUR_OUTLINE, emojiImageUrl };
})();
