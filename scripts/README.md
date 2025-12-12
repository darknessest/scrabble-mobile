# Dictionary Processing Scripts

These scripts download and process dictionary data for the Scrabble game, creating structured dictionaries with part-of-speech information, plural forms, and other metadata.

## Overview

The dictionary processing pipeline consists of two scripts:

1. **`download-dicts.js`** - Downloads raw dictionary data from various sources
2. **`parse-dicts.js`** - Processes raw data into structured JSON format

## Data Sources

### English
- **SOWPODS** (public domain) - Official international Scrabble word list (~267k words)
- **Wiktionary** (CC BY-SA 3.0) - For enhanced metadata (POS, plurals) - *optional, large*

### Russian
- **OpenRussian** (CC BY-SA) - Comprehensive Russian dictionary with morphological data

## Usage

### Prerequisites

- Node.js 18+ (for ES modules support)
- Internet connection for downloading

### Step 1: Download Raw Data

```bash
node scripts/download-dicts.js
```

This will:
- Download SOWPODS word list to `scripts/data/raw/sowpods.txt`
- Download OpenRussian CSV files to `scripts/data/raw/ru-*.csv`

**Note:** Full Wiktionary data (~6GB) is not downloaded automatically. If you need enhanced English metadata, you can manually download from [kaikki.org](https://kaikki.org/dictionary/English/index.html) and place it in `scripts/data/raw/`.

### Step 2: Parse and Process

```bash
node scripts/parse-dicts.js
```

This will:
- Parse SOWPODS and create structured English dictionary
- Parse OpenRussian CSV files and create structured Russian dictionary
- Output JSON files to `public/dicts/en.json` and `public/dicts/ru.json`

## Output Format

The processed dictionaries are JSON arrays with the following structure:

```typescript
interface DictionaryEntry {
  word: string;           // Uppercase word (e.g., "CAT")
  pos?: string[];         // Parts of speech: ["noun"], ["verb"], ["adj"], etc.
  plural?: string;        // Plural form (e.g., "CATS")
  base?: string;          // Base/infinitive form (e.g., "RUN" for "RUNS")
  forms?: string[];       // Other valid forms
}
```

Example:
```json
[
  {"word": "CAT", "pos": ["noun"], "plural": "CATS"},
  {"word": "RUN", "pos": ["verb"], "plural": "RUNS", "base": "RUN"}
]
```

## File Locations

- **Raw data:** `scripts/data/raw/` (gitignored)
- **Processed dictionaries:** `public/dicts/*.json` (committed to git)
- **Scripts:** `scripts/*.js`

## CI/CD

A GitHub Actions workflow (`.github/workflows/dictionaries.yml`) automatically:
1. Runs the download and parse scripts
2. Compresses the dictionaries using gzip
3. Pushes them to the `assets` branch

The dictionaries are served from the `assets` branch via GitHub's raw content CDN, allowing:
- Smaller downloads (compressed format)
- Independent updates without rebuilding the main app
- Better caching and CDN distribution

The workflow runs:
- Manually via `workflow_dispatch`
- Weekly on Mondays at 2 AM UTC
- When dictionary scripts are updated

## License Attribution

When using the processed dictionaries, please include appropriate attributions:

- **SOWPODS:** Public domain
- **OpenRussian:** Creative Commons Attribution-ShareAlike (CC BY-SA)
- **Wiktionary (if used):** Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)

## Troubleshooting

### Download fails
- Check your internet connection
- Verify the source URLs are still valid
- Some sources may have rate limiting

### Parse errors
- Ensure raw data files exist in `scripts/data/raw/`
- Check file encoding (should be UTF-8)
- Verify CSV format matches expected structure

### Large file sizes
- The processed dictionaries are optimized for size
- English: ~2-5 MB (depending on metadata)
- Russian: ~3-8 MB (depending on metadata)
- If files are too large, consider filtering by word length or frequency

## Updating Dictionaries

To update dictionaries:

1. Run `download-dicts.js` to get latest data
2. Run `parse-dicts.js` to regenerate JSON files
3. Commit the updated `public/dicts/*.json` files
4. Test the application to ensure compatibility
