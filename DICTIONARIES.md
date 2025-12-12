# Dictionary System

This document explains how the dictionary system works, including download, compression, and deployment.

## Overview

The Scrabble game uses structured dictionaries with part-of-speech information, plural forms, and other metadata. Dictionaries are:

1. **Downloaded** from public sources (SOWPODS for English, OpenRussian for Russian)
2. **Processed** into structured JSON format
3. **Compressed** using gzip
4. **Deployed** to a separate `assets` branch on GitHub
5. **Fetched** by the application with automatic decompression

## Architecture

### Dictionary Sources

- **English**: SOWPODS word list (public domain, ~267k words)
- **Russian**: OpenRussian dictionary (CC BY-SA, ~58k words)

### Storage

- **Raw data**: `scripts/data/raw/` (gitignored, not committed)
- **Processed dictionaries**: Generated locally, then pushed to `assets` branch
- **Compressed files**: `.json.gz` files served from GitHub raw content CDN

### Deployment Flow

```
Local Scripts → Process → Compress → Push to assets branch → CDN → Client
```

## Usage

### For Developers

#### Manual Dictionary Update

1. **Download dictionaries**:
   ```bash
   npm run dicts:download
   ```

2. **Parse and process**:
   ```bash
   npm run dicts:parse
   ```

3. **Compress** (optional, done automatically in CI):
   ```bash
   cd public/dicts
   gzip -k -9 en.json ru.json
   ```

4. **Trigger CI workflow**:
   - Go to GitHub Actions
   - Run "Generate Dictionaries" workflow manually
   - Or wait for scheduled run (weekly on Mondays)

#### Automatic Updates

The GitHub Actions workflow (`.github/workflows/dictionaries.yml`) automatically:
- Runs on schedule (weekly)
- Runs when dictionary scripts are updated
- Can be triggered manually

### For Users

Dictionaries are automatically downloaded when:
- User clicks "Download EN pack" or "Download RU pack"
- Application detects dictionary is missing

The application will:
1. Try compressed format first (smallest download)
2. Fall back to uncompressed if compression fails
3. Fall back to legacy text format if JSON unavailable
4. Cache in IndexedDB for offline use

## Configuration

### Repository URL

Update the repository path in `src/dictionary/dictionaryService.ts`:

```typescript
const GITHUB_REPO = import.meta.env.VITE_GITHUB_REPO || 'your-username/your-repo';
```

Or set via environment variable during build:

```bash
VITE_GITHUB_REPO=your-username/your-repo npm run build
```

### Dictionary URLs

Dictionaries are served from:
- Compressed: `https://raw.githubusercontent.com/{REPO}/assets/dicts/{lang}.json.gz`
- Uncompressed: `https://raw.githubusercontent.com/{REPO}/assets/dicts/{lang}.json`

## Compression

### Why Compress?

- **English dictionary**: ~7.2 MB → ~1.5 MB (gzip)
- **Russian dictionary**: ~15 MB → ~3 MB (gzip)
- **Total savings**: ~75% reduction in download size

### Decompression

The application uses the browser's native `DecompressionStream` API (available in modern browsers) to decompress gzip files on-the-fly.

## Dictionary Format

```typescript
interface DictionaryEntry {
  word: string;           // Uppercase word
  pos?: string[];         // Parts of speech: ["noun"], ["verb"], etc.
  plural?: string;        // Plural form
  base?: string;          // Base/infinitive form
  forms?: string[];       // Other valid forms (cases, conjugations)
}
```

Example:
```json
{
  "word": "CAT",
  "pos": ["noun"],
  "plural": "CATS"
}
```

## Troubleshooting

### Dictionaries not downloading

1. Check network connection
2. Verify GitHub repository URL is correct
3. Ensure `assets` branch exists and contains dictionaries
4. Check browser console for errors

### Decompression fails

- Ensure browser supports `DecompressionStream` API (Chrome 80+, Firefox 113+, Safari 16.4+)
- Falls back to uncompressed format automatically

### Workflow fails

1. Check GitHub Actions logs
2. Verify repository permissions (needs `contents: write`)
3. Ensure `assets` branch can be created/pushed to

## License Attribution

When using dictionaries, include appropriate attributions:

- **SOWPODS**: Public domain
- **OpenRussian**: Creative Commons Attribution-ShareAlike (CC BY-SA)
- **Wiktionary** (if used): Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)
