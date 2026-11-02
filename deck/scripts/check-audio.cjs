#!/usr/bin/env node
/**
 * Check that all expected audio files exist before rendering.
 * Exits with error if any are missing.
 */

const fs = require('fs');
const path = require('path');

const deckDir = path.join(__dirname, '..');
const audioDir = path.join(deckDir, 'audio');
const narrationDir = path.join(deckDir, 'narration');

const narrationFiles = fs.readdirSync(narrationDir)
  .filter(f => f.endsWith('.md'))
  .sort();

const missingFiles = [];

for (const narrationFile of narrationFiles) {
  const slug = narrationFile.replace('.md', '');
  const audioFile = path.join(audioDir, `${slug}.wav`);
  
  if (!fs.existsSync(audioFile)) {
    missingFiles.push(`deck/audio/${slug}.wav`);
  }
}

if (missingFiles.length > 0) {
  console.error('\nERROR: Missing audio files. Run deck/scripts/tts.sh first.\n');
  console.error('Missing files:');
  for (const file of missingFiles) {
    console.error(`  - ${file}`);
  }
  console.error('');
  process.exit(1);
}

console.log(`✓ All ${narrationFiles.length} audio files present`);
