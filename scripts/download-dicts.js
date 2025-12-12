#!/usr/bin/env node

/**
 * Dictionary Download Script
 * 
 * Downloads raw dictionary data for processing:
 * - English: SOWPODS word list + Wiktionary data
 * - Russian: OpenRussian dictionary
 * 
 * Run with: node scripts/download-dicts.js
 * 
 * Downloads will be saved to scripts/data/raw/
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const RAW_DIR = path.join(DATA_DIR, 'raw');

// Ensure directories exist
[DATA_DIR, RAW_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = createWriteStream(outputPath);
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirects
        return downloadFile(response.headers.location, outputPath)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(outputPath);
        reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded to ${outputPath}`);
        resolve();
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      reject(err);
    });
  });
}

async function downloadEnglish() {
  console.log('\n=== Downloading English Dictionaries ===\n');
  
  // SOWPODS word list (public domain) - try multiple sources
  const sowpodsUrls = [
    'https://raw.githubusercontent.com/speedreeder/ScrabbleWordChecker/master/sowpods.txt',
    'https://raw.githubusercontent.com/pillowfication/pf-sowpods/master/sowpods.txt',
    'https://raw.githubusercontent.com/vtortola/dawg/master/src/main/resources/sowpods.txt'
  ];
  
  let downloaded = false;
  for (const url of sowpodsUrls) {
    try {
      await downloadFile(url, path.join(RAW_DIR, 'sowpods.txt'));
      downloaded = true;
      break;
    } catch (error) {
      console.log(`Failed to download from ${url}, trying next source...`);
      continue;
    }
  }
  
  if (!downloaded) {
    console.log('\n⚠ Warning: Could not download SOWPODS from any source.');
    console.log('You can manually download it from:');
    console.log('  - https://www.freescrabbledictionary.com/sowpods/');
    console.log('  - Or search for "sowpods.txt" on GitHub');
    console.log('  - Save it as: scripts/data/raw/sowpods.txt\n');
  }
  
  // Note: Full Wiktionary is too large. We'll use a subset or process it separately.
  // For now, we'll use SOWPODS as base and enhance with a smaller Wiktionary extract
  console.log('\nNote: Full Wiktionary (~6GB) is too large to download automatically.');
  console.log('For enhanced data (POS, plurals), download from:');
  console.log('https://kaikki.org/dictionary/English/index.html');
  console.log('Or use the parse script with a pre-downloaded Wiktionary JSON file.');
}

async function downloadRussian() {
  console.log('\n=== Downloading Russian Dictionaries ===\n');
  
  // OpenRussian dictionary files
  const baseUrl = 'https://raw.githubusercontent.com/Badestrand/russian-dictionary/master';
  const files = ['nouns.csv', 'verbs.csv', 'adjectives.csv', 'others.csv'];
  
  for (const file of files) {
    const url = `${baseUrl}/${file}`;
    await downloadFile(url, path.join(RAW_DIR, `ru-${file}`));
  }
  
  console.log('\n✓ Russian dictionary files downloaded');
}

async function main() {
  try {
    console.log('Starting dictionary downloads...\n');
    
    await downloadEnglish();
    await downloadRussian();
    
    console.log('\n=== Download Complete ===');
    console.log(`\nRaw files saved to: ${RAW_DIR}`);
    console.log('\nNext step: Run "node scripts/parse-dicts.js" to process the data.\n');
  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();
