// =====================================================
// KG Chart — Batch Image Uploader to Supabase Storage
// =====================================================
// Usage:
//   1. npm install @supabase/supabase-js
//   2. node upload_images.js
//
// Reads images from D:\KG_chart\{topic}\{filename}
// Uploads to Supabase storage: vocabulary-assets/{topic}/{filename}
// Skips files that already exist in storage.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// === CONFIG ===
const SUPABASE_URL = 'https://ulgrfumbwjovbjzjiems.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZ3JmdW1id2pvdmJqemppZW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjczNzIyNjcsImV4cCI6MjA4Mjk0ODI2N30.ix5Vh4Y3GXNbQbzVtTD_WSko0L3cr5q_eCnTuDEMh7M';
const BUCKET = 'vocabulary-assets';
const LOCAL_ROOT = 'D:\\KG_chart';

// Image extensions to upload
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getExistingFiles() {
  // List all files already in storage, grouped by topic folder
  const existing = new Set();

  // First get top-level folders
  const { data: folders, error: folderErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 100 });

  if (folderErr) {
    console.error('❌ Error listing storage:', folderErr.message);
    return existing;
  }

  // For each folder, list files inside
  for (const folder of folders) {
    if (!folder.id && folder.name) {
      // It's a folder (no id means folder in Supabase storage)
      const { data: files } = await supabase.storage
        .from(BUCKET)
        .list(folder.name, { limit: 1000 });

      if (files) {
        files.forEach(f => {
          if (f.name) existing.add(`${folder.name}/${f.name}`);
        });
      }
    }
  }

  return existing;
}

function getContentType(ext) {
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return types[ext] || 'image/jpeg';
}

async function main() {
  console.log('==========================================');
  console.log('  KG Chart — Batch Image Uploader');
  console.log('==========================================');
  console.log(`📂 Local folder: ${LOCAL_ROOT}`);
  console.log(`☁️  Bucket: ${BUCKET}`);
  console.log('');

  // Check local folder exists
  if (!fs.existsSync(LOCAL_ROOT)) {
    console.error(`❌ Folder not found: ${LOCAL_ROOT}`);
    console.log('   Update LOCAL_ROOT in this script to match your image folder.');
    process.exit(1);
  }

  // Get existing files in storage
  console.log('🔍 Checking existing files in Supabase storage...');
  const existing = await getExistingFiles();
  console.log(`   Found ${existing.size} files already uploaded.\n`);

  // Scan local folders
  const topicFolders = fs.readdirSync(LOCAL_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  console.log(`📁 Found ${topicFolders.length} topic folders: ${topicFolders.join(', ')}\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let notFound = 0;
  const errors = [];

  for (const topic of topicFolders) {
    const topicPath = path.join(LOCAL_ROOT, topic);
    const files = fs.readdirSync(topicPath)
      .filter(f => IMAGE_EXTS.includes(path.extname(f).toLowerCase()));

    if (files.length === 0) {
      console.log(`⚠️  ${topic}/ — no image files found`);
      continue;
    }

    console.log(`📤 ${topic}/ — ${files.length} images`);

    for (const file of files) {
      const storagePath = `${topic}/${file}`;

      // Skip if already exists
      if (existing.has(storagePath)) {
        skipped++;
        continue;
      }

      const filePath = path.join(topicPath, file);
      const fileBuffer = fs.readFileSync(filePath);
      const ext = path.extname(file).toLowerCase();

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, fileBuffer, {
          contentType: getContentType(ext),
          upsert: false,
        });

      if (error) {
        if (error.message?.includes('already exists') || error.statusCode === 409) {
          skipped++;
        } else {
          failed++;
          errors.push({ file: storagePath, error: error.message });
          process.stdout.write('   ❌ ');
          console.log(`${file} — ${error.message}`);
        }
      } else {
        uploaded++;
        process.stdout.write('   ✅ ');
        console.log(file);
      }
    }
  }

  // Summary
  console.log('\n==========================================');
  console.log('📊 UPLOAD SUMMARY');
  console.log('==========================================');
  console.log(`✅ Uploaded:  ${uploaded}`);
  console.log(`⏭️  Skipped:   ${skipped} (already exist)`);
  console.log(`❌ Failed:    ${failed}`);
  console.log('==========================================');

  if (errors.length > 0) {
    console.log('\n❌ ERRORS:');
    errors.forEach(e => console.log(`   ${e.file} — ${e.error}`));
  }

  if (uploaded > 0) {
    console.log(`\n🎉 Done! ${uploaded} new images uploaded to Supabase storage.`);
    console.log('   Refresh your KG Chart app to see them.');
  } else if (failed === 0) {
    console.log('\n✨ All images are already uploaded!');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
