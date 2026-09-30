# Prompt for Claude — find images for KG Chart vocabulary

I'm building a picture vocabulary chart for language learners (Burmese, Sinhala, Tamil etc.). Each vocabulary item needs one clear photo. Below is a list of items that have no image yet, in the form `topic / English word`.

For each item, give me:

1. **Search query** — the best 2–4 word query to type into Openverse or Wikimedia Commons to find a clear, simple photo of that thing. Make it more specific than the bare word where needed (e.g. "Single" in the hotel topic → "hotel single bed room"; "Twin" → "hotel twin beds").
2. **Best source** — "Openverse" for everyday objects and everyday scenes, "Wikimedia" for reference images of things, places and food.
3. **Direct image URL** — if you can search the web, find one Creative Commons or public-domain image on Wikimedia Commons and give me the direct file URL (the one ending in .jpg or .png from upload.wikimedia.org, ideally a 640px thumbnail). Include the licence and author. Leave blank if you can't find a good one.

Rules for a good image:
- One object or scene, plain background where possible, no text or watermarks, no people's faces unless the word is about a person.
- Suitable for beginners and children.
- Prefer photos over drawings.

Return a table with columns: topic, english_text, search_query, source, image_url, licence, author.

Items:
(paste list here, one per line, e.g. `hotel / Room key`)
