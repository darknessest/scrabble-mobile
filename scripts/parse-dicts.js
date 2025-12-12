#!/usr/bin/env node

/**
 * Dictionary Parsing Script
 * 
 * Processes raw dictionary data into structured format for the Scrabble game.
 * Output format: JSON with word, POS, plural forms, and base forms.
 * 
 * Run with: node scripts/parse-dicts.js
 * 
 * Outputs will be saved to public/dicts/ as JSON files.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RAW_DIR = path.join(__dirname, 'data', 'raw');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'dicts');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Dictionary entry schema
 * @typedef {Object} DictionaryEntry
 * @property {string} word - Uppercase word
 * @property {string[]} [pos] - Parts of speech: noun, verb, adj, etc.
 * @property {string} [plural] - Plural form (if applicable)
 * @property {string} [base] - Base/infinitive form
 * @property {string[]} [forms] - Other valid forms
 */

/**
 * Parse SOWPODS word list (English)
 */
async function parseSowpods() {
  const filePath = path.join(RAW_DIR, 'sowpods.txt');
  if (!fs.existsSync(filePath)) {
    throw new Error(`SOWPODS file not found: ${filePath}`);
  }

  console.log('Parsing SOWPODS word list...');
  const dict = new Map();
  
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let count = 0;
  for await (const line of rl) {
    const word = line.trim().toUpperCase();
    if (word && word.length >= 2 && /^[A-Z]+$/.test(word)) {
      dict.set(word, { word });
      count++;
    }
  }

  console.log(`✓ Parsed ${count} English words from SOWPODS`);
  return dict;
}

/**
 * Enhance English dictionary with basic plural detection
 * Simple heuristic: add 'S' or 'ES' for common plural patterns
 */
function enhanceEnglishDict(dict) {
  console.log('Enhancing English dictionary with plural forms...');
  
  const enhanced = new Map(dict);
  let pluralCount = 0;

  for (const [word, entry] of dict.entries()) {
    // Skip if already has plural
    if (entry.plural) continue;

    // Simple plural detection heuristics
    if (word.endsWith('Y') && word.length > 3) {
      // Try -> Tries
      const base = word.slice(0, -1) + 'IES';
      if (dict.has(base)) {
        entry.plural = base;
        entry.base = word;
        pluralCount++;
      }
    } else if (word.endsWith('S') && !word.endsWith('SS')) {
      // Try singular form
      const singular = word.slice(0, -1);
      if (dict.has(singular)) {
        const singularEntry = enhanced.get(singular);
        if (singularEntry && !singularEntry.plural) {
          singularEntry.plural = word;
          pluralCount++;
        }
      }
    } else if (word.endsWith('ES') && word.length > 4) {
      // Try singular form (remove ES)
      const singular = word.slice(0, -2);
      if (dict.has(singular)) {
        const singularEntry = enhanced.get(singular);
        if (singularEntry && !singularEntry.plural) {
          singularEntry.plural = word;
          pluralCount++;
        }
      }
    }
  }

  console.log(`✓ Added ${pluralCount} plural form mappings`);
  return enhanced;
}

/**
 * Parse Russian dictionary from OpenRussian CSV files
 * Format: Tab-separated, first column is the word (bare form)
 */
async function parseRussianCSV(filename, posTag) {
  const filePath = path.join(RAW_DIR, `ru-${filename}`);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} not found, skipping...`);
    return new Map();
  }

  console.log(`Parsing ${filename}...`);
  const dict = new Map();
  
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let count = 0;
  
  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // Skip header
    
    // OpenRussian CSV files are tab-separated
    const parts = line.split('\t');
    if (parts.length < 1) continue;
    
    // First column is the bare word form (lowercase Cyrillic)
    const bareWord = parts[0]?.trim();
    if (!bareWord || bareWord.length < 2) continue;
    
    // Convert to uppercase for consistency
    const word = bareWord.toUpperCase();
    
    // Only keep Cyrillic letters (remove any accent marks or other characters)
    const cleaned = word.replace(/[^А-ЯЁ]/g, '');
    if (!cleaned || cleaned.length < 2) continue;
    
    // Also check for plural forms in the CSV (columns 11-16 are singular forms, 17-22 are plural)
    const forms = [];
    if (parts.length > 11) {
      // Singular forms (columns 11-16: sg_nom, sg_gen, sg_dat, sg_acc, sg_inst, sg_prep)
      for (let i = 11; i <= 16 && i < parts.length; i++) {
        const form = parts[i]?.trim().toUpperCase().replace(/[^А-ЯЁ]/g, '');
        if (form && form.length >= 2 && form !== cleaned) {
          forms.push(form);
        }
      }
      // Plural forms (columns 17-22: pl_nom, pl_gen, pl_dat, pl_acc, pl_inst, pl_prep)
      for (let i = 17; i <= 22 && i < parts.length; i++) {
        const form = parts[i]?.trim().toUpperCase().replace(/[^А-ЯЁ]/g, '');
        if (form && form.length >= 2 && form !== cleaned) {
          forms.push(form);
        }
      }
    }
    
    const existing = dict.get(cleaned);
    if (existing) {
      // Add POS if not already present
      if (!existing.pos) existing.pos = [];
      if (!existing.pos.includes(posTag)) {
        existing.pos.push(posTag);
      }
      // Merge forms
      if (forms.length > 0) {
        if (!existing.forms) existing.forms = [];
        forms.forEach(form => {
          if (!existing.forms.includes(form)) {
            existing.forms.push(form);
          }
        });
      }
    } else {
      const entry = {
        word: cleaned,
        pos: [posTag],
      };
      if (forms.length > 0) {
        entry.forms = forms;
      }
      // Try to identify plural form (usually pl_nom, column 17)
      if (parts.length > 17 && parts[17]) {
        const plural = parts[17].trim().toUpperCase().replace(/[^А-ЯЁ]/g, '');
        if (plural && plural.length >= 2 && plural !== cleaned) {
          entry.plural = plural;
        }
      }
      dict.set(cleaned, entry);
      count++;
    }
  }

  console.log(`✓ Parsed ${count} words from ${filename}`);
  return dict;
}

/**
 * Merge multiple Russian dictionaries
 */
async function parseRussian() {
  console.log('\nParsing Russian dictionaries...\n');
  
  const nouns = await parseRussianCSV('nouns.csv', 'noun');
  const verbs = await parseRussianCSV('verbs.csv', 'verb');
  const adjectives = await parseRussianCSV('adjectives.csv', 'adj');
  const others = await parseRussianCSV('others.csv', 'other');
  
  // Merge all dictionaries
  const merged = new Map();
  
  for (const dict of [nouns, verbs, adjectives, others]) {
    for (const [word, entry] of dict.entries()) {
      const existing = merged.get(word);
      if (existing) {
        // Merge POS tags
        if (entry.pos) {
          existing.pos = [...new Set([...(existing.pos || []), ...entry.pos])];
        }
      } else {
        merged.set(word, { ...entry });
      }
    }
  }
  
  console.log(`\n✓ Total Russian words: ${merged.size}`);
  return merged;
}

/**
 * Convert dictionary to JSON format for storage
 */
function dictToJSON(dict) {
  const entries = Array.from(dict.values());
  return JSON.stringify(entries, null, 0); // Compact JSON
}

/**
 * Save dictionary to file
 */
function saveDictionary(language, dict) {
  const json = dictToJSON(dict);
  const outputPath = path.join(OUTPUT_DIR, `${language}.json`);
  fs.writeFileSync(outputPath, json, 'utf8');
  
  const sizeKB = (Buffer.byteLength(json, 'utf8') / 1024).toFixed(2);
  console.log(`✓ Saved ${dict.size} words to ${outputPath} (${sizeKB} KB)`);
}

async function main() {
  try {
    console.log('Starting dictionary parsing...\n');
    
    // Parse English
    console.log('=== Processing English Dictionary ===\n');
    let englishDict = await parseSowpods();
    englishDict = enhanceEnglishDict(englishDict);
    saveDictionary('en', englishDict);
    
    // Parse Russian
    console.log('\n=== Processing Russian Dictionary ===\n');
    const russianDict = await parseRussian();
    saveDictionary('ru', russianDict);
    
    console.log('\n=== Parsing Complete ===');
    console.log(`\nDictionaries saved to: ${OUTPUT_DIR}`);
    console.log('\nThe dictionaries are now ready to use in the application.\n');
  } catch (error) {
    console.error('\nError:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
