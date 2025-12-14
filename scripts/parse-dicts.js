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
 * Scrabble rule validation and filtering
 * Based on official Scrabble rules:
 * - Proper nouns (names, places) are NOT allowed
 * - Abbreviations are NOT allowed (unless they've become standard words like "laser", "scuba")
 * - Inflected forms (plurals, conjugations) ARE allowed
 * - Foreign words ARE allowed if widely adopted
 */

// Common English abbreviations that have become standard words (allowed)
const ALLOWED_ENGLISH_ABBREVIATIONS = new Set([
  'LASER', 'SCUBA', 'RADAR', 'SONAR', 'NATO', 'UNESCO', 'AIDS', 'OK', 'AWOL',
  'ZIP', 'GIF', 'JPEG', 'MPEG', 'CD', 'DVD', 'TV', 'PC', 'IQ', 'EQ'
]);

// Common Russian abbreviations that have become standard words (allowed)
const ALLOWED_RUSSIAN_ABBREVIATIONS = new Set([
  'СССР', 'КГБ', 'КПСС', 'НАТО', 'ЮНЕСКО', 'СПИД', 'ВИЧ', 'ТВ', 'ПК'
]);

// Common proper noun patterns (case-insensitive checks)
const PROPER_NOUN_PATTERNS = {
  en: [
    // Common name patterns
    /^[A-Z][a-z]+(?:son|sen|berg|stein|ski|ova|ev|in|ov)$/,
    // Place names ending patterns
    /^(?:NEW|OLD|NORTH|SOUTH|EAST|WEST|GREAT|LITTLE|UPPER|LOWER|CENTRAL)[A-Z]+$/,
    // Common city/country endings
    /^(?:.*(?:TON|VILLE|BURG|BOROUGH|CITY|PORT|LAND|STAN|IA|SK|OV))$/,
  ],
  ru: [
    // Russian name patterns (patronymics, surnames)
    /^(?:.*(?:ОВИЧ|ЕВИЧ|ИЧ|ОВ|ЕВ|ИН|СКИЙ|ЦКИЙ|ОВА|ЕВА|ИНА|СКАЯ|ЦКАЯ))$/,
    // Place name patterns
    /^(?:.*(?:ГРАД|ГОРОД|СК|ОВО|ЕВО|ИНО|СКОЕ|ЦКОЕ))$/,
  ]
};

/**
 * Check if an English word is likely a proper noun
 * SOWPODS is already curated, so we use conservative filtering - only flag obvious cases
 */
function isLikelyProperNounEN(word) {
  // SOWPODS should already exclude proper nouns, so we're very conservative
  // Only filter obvious proper nouns that might have slipped through
  
  // Very common proper nouns that definitely shouldn't be in Scrabble
  const alwaysCapitalized = [
    'JOHN', 'MARY', 'JAMES', 'ROBERT', 'MICHAEL', 'WILLIAM', 'DAVID', 'RICHARD',
    'JOSEPH', 'THOMAS', 'CHARLES', 'CHRISTOPHER', 'DANIEL', 'MATTHEW', 'ANTHONY',
    'MARK', 'DONALD', 'STEVEN', 'PAUL', 'ANDREW', 'JOSHUA', 'KENNETH', 'KEVIN',
    'BRIAN', 'GEORGE', 'EDWARD', 'RONALD', 'TIMOTHY', 'JASON', 'JEFFREY', 'RYAN',
    'JACOB', 'GARY', 'NICHOLAS', 'ERIC', 'JONATHAN', 'STEPHEN', 'LARRY', 'JUSTIN',
    'SCOTT', 'BRANDON', 'BENJAMIN', 'SAMUEL', 'FRANK', 'GREGORY', 'RAYMOND',
    'ALEXANDER', 'PATRICK', 'JACK', 'DENNIS', 'JERRY', 'TYLER', 'AARON', 'JOSE',
    'HENRY', 'ADAM', 'DOUGLAS', 'NATHAN', 'PETER', 'ZACHARY', 'KYLE', 'NOAH',
    'ETHAN', 'JEREMY', 'WALTER', 'CHRISTIAN', 'KEITH', 'ROGER', 'TERRY', 'AUSTIN',
    'SEAN', 'GERALD', 'CARL', 'HAROLD', 'DYLAN', 'LOUIS', 'ARTHUR', 'JORDAN',
    'WAYNE', 'ALAN', 'JUAN', 'ALBERT', 'WILLIE', 'LAWRENCE', 'RANDY', 'ROY',
    'RALPH', 'NICHOLAS', 'EUGENE', 'RUSSELL', 'BOBBY', 'MASON', 'PHILIP', 'LOUIS',
    'JOHNNY', 'JESSE', 'JOHNNY', 'JESSE', 'JOHNNY', 'JESSE',
    // Common place names
    'LONDON', 'PARIS', 'MOSCOW', 'BERLIN', 'ROME', 'MADRID', 'AMSTERDAM',
    'VIENNA', 'ATHENS', 'STOCKHOLM', 'OSLO', 'COPENHAGEN', 'HELSINKI',
    'WARSAW', 'PRAGUE', 'BUDAPEST', 'BUCHAREST', 'SOFIA', 'BELGRADE',
    'ZAGREB', 'LJUBLJANA', 'BRATISLAVA', 'TALLINN', 'RIGA', 'VILNIUS',
    'KIEV', 'MINSK', 'CHISINAU', 'TBILISI', 'YEREVAN', 'BAKU',
    'NEWYORK', 'LOSANGELES', 'CHICAGO', 'HOUSTON', 'PHOENIX', 'PHILADELPHIA',
    'SANANTONIO', 'SANDIEGO', 'DALLAS', 'SANJOSE', 'AUSTIN', 'JACKSONVILLE',
    'SANFRANCISCO', 'INDIANAPOLIS', 'COLUMBUS', 'FORTWORTH', 'CHARLOTTE',
    'SEATTLE', 'DENVER', 'ELPASO', 'DETROIT', 'WASHINGTON', 'BOSTON',
    'MEMPHIS', 'NASHVILLE', 'PORTLAND', 'OKLAHOMACITY', 'LASVEGAS',
    'BALTIMORE', 'LOUISVILLE', 'MILWAUKEE', 'ALBUQUERQUE', 'TUCSON',
    'FRESNO', 'SACRAMENTO', 'KANSASCITY', 'MESA', 'ATLANTA', 'OMAHA',
    'COLORADOSPRINGS', 'RALEIGH', 'VIRGINIABEACH', 'MIAMI', 'OAKLAND',
    'MINNEAPOLIS', 'TULSA', 'CLEVELAND', 'WICHITA', 'ARLINGTON',
    'RUSSIA', 'AMERICA', 'ENGLAND', 'FRANCE', 'GERMANY', 'ITALY', 'SPAIN',
    'POLAND', 'UKRAINE', 'BELARUS', 'MOLDOVA', 'GEORGIA', 'ARMENIA', 'AZERBAIJAN'
  ];
  
  if (alwaysCapitalized.includes(word)) {
    return true;
  }
  
  // For SOWPODS, we're conservative - don't use pattern matching
  // as SOWPODS is already curated. Only filter explicit known proper nouns.
  
  return false;
}

/**
 * Check if a Russian word is likely a proper noun
 * OpenRussian is a general dictionary, so we need more aggressive filtering
 */
function isLikelyProperNounRU(word) {
  // Common Russian names (first names, surnames) - filter these out
  const commonNames = [
    'ИВАН', 'ПЕТР', 'СЕРГЕЙ', 'АНДРЕЙ', 'АЛЕКСАНДР', 'ДМИТРИЙ', 'АЛЕКСЕЙ',
    'МАКСИМ', 'ЕВГЕНИЙ', 'МИХАИЛ', 'НИКОЛАЙ', 'РОМАН', 'ОЛЕГ', 'ВЛАДИМИР',
    'ИГОРЬ', 'ДЕНИС', 'СТАНИСЛАВ', 'ВИТАЛИЙ', 'НИКИТА', 'ВАДИМ', 'ЮРИЙ',
    'АННА', 'МАРИЯ', 'ЕЛЕНА', 'ОЛЬГА', 'ТАТЬЯНА', 'НАТАЛЬЯ', 'ИРИНА',
    'СВЕТЛАНА', 'ЕКАТЕРИНА', 'НАДЕЖДА', 'ВАЛЕНТИНА', 'ГАЛИНА', 'ЛЮДМИЛА',
    'ЛЮБОВЬ', 'НИНА', 'ВАЛЕРИЯ', 'ДИАНА', 'МАРГАРИТА', 'ВИКТОРИЯ',
    // Common surnames
    'ИВАНОВ', 'ПЕТРОВ', 'СИДОРОВ', 'СМИРНОВ', 'КУЗНЕЦОВ', 'ПОПОВ', 'СОКОЛОВ',
    'ЛЕБЕДЕВ', 'КОЗЛОВ', 'НОВИКОВ', 'МОРОЗОВ', 'ПЕТРОВ', 'ВОЛКОВ', 'СОЛОВЬЕВ',
    'ВАСИЛЬЕВ', 'ЗАЙЦЕВ', 'ПАВЛОВ', 'СЕМЕНОВ', 'ГОЛУБЕВ', 'ВИНОГРАДОВ',
    // Place names
    'МОСКВА', 'САНКТПЕТЕРБУРГ', 'НОВОСИБИРСК', 'ЕКАТЕРИНБУРГ', 'НИЖНИЙНОВГОРОД',
    'КАЗАНЬ', 'ЧЕЛЯБИНСК', 'ОМСК', 'САМАРА', 'РОСТОВНАДОНУ', 'УФА', 'КРАСНОЯРСК',
    'ВОРОНЕЖ', 'ПЕРМЬ', 'ВОЛГОГРАД', 'КРАСНОДАР', 'САРАТОВ', 'ТЮМЕНЬ', 'ТОЛЬЯТТИ',
    'ИЖЕВСК', 'БАРНАУЛ', 'УЛЬЯНОВСК', 'ИРКУТСК', 'ХАБАРОВСК', 'ЯРОСЛАВЛЬ',
    'ВЛАДИВОСТОК', 'МАХАЧКАЛА', 'ТОМСК', 'ОРЕНБУРГ', 'КЕМЕРОВО', 'НОВОКУЗНЕЦК',
    'РЯЗАНЬ', 'АСТРАХАНЬ', 'НАБЕРЕЖНЫЕЧЕЛНЫ', 'ПЕНЗА', 'ЛИПЕЦК', 'ТУЛА',
    'КИРОВ', 'ЧЕБОКСАРЫ', 'КАЛИНИНГРАД', 'КУРСК', 'УЛАНУДЭ', 'СТАВРОПОЛЬ',
    'СОЧИ', 'ТВЕРЬ', 'МАГНИТОГОРСК', 'ИВАНОВО', 'БРЯНСК', 'БЕЛГОРОД',
    'СУРГУТ', 'ВЛАДИКАВКАЗ', 'ЧИТА', 'КАЛУГА', 'ОРЛ', 'СМОЛЕНСК', 'МУРМАНСК',
    'ВОЛЖСКИЙ', 'КУРГАН', 'ЧЕРЕПОВЕЦ', 'ВОЛОГДА', 'САРАНСК', 'ТАГАНРОГ',
    'СТЕРЛИТАМАК', 'КОСТРОМА', 'ПЕТРОЗАВОДСК', 'НИЖНЕВАРТОВСК', 'НОВОРОССИЙСК',
    'ЙОШКАРОЛА', 'БАЛАШИХА', 'ХИМКИ', 'ПОДОЛЬСК', 'КОРОЛЕВ', 'МЫТИЩИ',
    'ЛЮБЕРЦЫ', 'КОЛОМНА', 'ЭЛЕКТРОСТАЛЬ', 'ОДИНЦОВО', 'ЖЕЛЕЗНОДОРОЖНЫЙ',
    'СЕРПУХОВ', 'ОРЕХОВОЗУЕВО', 'НОГИНСК', 'ЩЕЛКОВО', 'ДМИТРОВ', 'ДОЛГОПРУДНЫЙ',
    'РАМЕНСКОЕ', 'СЕРГИЕВПОСАД', 'ЖУКОВСКИЙ', 'КЛИН', 'СОЛНЕЧНОГОРСК',
    'ДЗЕРЖИНСКИЙ', 'КАШИРА', 'НАРОФОМИНСК', 'ПУШКИНО', 'ЛОБНЯ', 'ДЕДОВСК',
    'КРАСНОГОРСК', 'ИСТРА', 'ВОСКРЕСЕНСК', 'ЕГОРЬЕВСК', 'ШАТУРА', 'ОЗЕРЫ',
    'КОЛОМНА', 'ЛУХОВИЦЫ', 'СТУПИНО', 'КАШИРА', 'СЕРЕБРЯНЫЕПРУДЫ',
    'ЗАРАЙСК', 'ОЗЕРЫ', 'КОЛОМНА', 'ЛУХОВИЦЫ', 'СТУПИНО', 'КАШИРА',
    // Countries
    'РОССИЯ', 'УКРАИНА', 'БЕЛАРУСЬ', 'КАЗАХСТАН', 'УЗБЕКИСТАН', 'ТУРКМЕНИСТАН',
    'КИРГИЗИЯ', 'ТАДЖИКИСТАН', 'АРМЕНИЯ', 'АЗЕРБАЙДЖАН', 'ГРУЗИЯ', 'МОЛДОВА',
    'ЭСТОНИЯ', 'ЛАТВИЯ', 'ЛИТВА', 'ПОЛЬША', 'ЧЕХИЯ', 'СЛОВАКИЯ', 'ВЕНГРИЯ',
    'РУМЫНИЯ', 'БОЛГАРИЯ', 'СЕРБИЯ', 'ХОРВАТИЯ', 'СЛОВЕНИЯ', 'МАКЕДОНИЯ',
    'АЛБАНИЯ', 'ЧЕРНОГОРИЯ', 'БОСНИЯ', 'ГЕРЦЕГОВИНА', 'ФИНЛЯНДИЯ', 'ШВЕЦИЯ',
    'НОРВЕГИЯ', 'ДАНИЯ', 'ИСЛАНДИЯ', 'ГЕРМАНИЯ', 'ФРАНЦИЯ', 'ИТАЛИЯ', 'ИСПАНИЯ',
    'ПОРТУГАЛИЯ', 'ГРЕЦИЯ', 'ТУРЦИЯ', 'КИТАЙ', 'ЯПОНИЯ', 'ИНДИЯ', 'БРАЗИЛИЯ',
    'АРГЕНТИНА', 'МЕКСИКА', 'КАНАДА', 'АВСТРАЛИЯ', 'НОВАЯЗЕЛАНДИЯ', 'ЮЖНАЯАФРИКА',
    'ЕГИПЕТ', 'НИГЕРИЯ', 'КЕНИЯ', 'ЭФИОПИЯ', 'МАРОККО', 'АЛЖИР', 'ТУНИС', 'ЛИВИЯ',
    'СУДАН', 'СОМАЛИ', 'ЭРИТРЕЯ', 'ДЖИБУТИ', 'МАВРИТАНИЯ', 'МАЛИ', 'НИГЕР', 'ЧАД',
    'ЦЕНТРАЛЬНОАФРИКАНСКАЯРЕСПУБЛИКА', 'КАМЕРУН', 'ЭКВАТОРИАЛЬНАЯГВИНЕЯ', 'ГАБОН',
    'РЕСПУБЛИКАКОНГО', 'ДЕМОКРАТИЧЕСКАЯРЕСПУБЛИКАКОНГО', 'АНГОЛА', 'ЗАМБИЯ',
    'МАЛАВИ', 'МОЗАМБИК', 'МАДАГАСКАР', 'МАВРИКИЙ', 'СЕЙШЕЛЫ', 'КОМОРЫ',
    'КАБОВЕРДЕ', 'ГВИНЕЯБИСАУ', 'ГВИНЕЯ', 'СЬЕРРАЛЕОНЕ', 'ЛИБЕРИЯ', 'КОТДИВУАР',
    'ГАНА', 'ТОГО', 'БЕНИН', 'БУРКИНАФАСО', 'СЕНЕГАЛ', 'ГАМБИЯ', 'ГВИНЕЯБИСАУ'
  ];
  
  if (commonNames.includes(word)) {
    return true;
  }
  
  // For Russian, we rely primarily on explicit lists rather than patterns
  // because pattern matching might filter out valid genitive forms, etc.
  // Patterns are kept for reference but not actively used to avoid false positives
  
  return false;
}

/**
 * Check if a word is likely an abbreviation (not allowed unless it's become a standard word)
 */
function isLikelyAbbreviation(word, language) {
  // Very short words (2-3 letters) that are all caps might be abbreviations
  // But we allow common ones that have become standard words
  if (language === 'en') {
    if (ALLOWED_ENGLISH_ABBREVIATIONS.has(word)) {
      return false; // Allowed abbreviation
    }
    // Check for common abbreviation patterns
    if (word.length <= 3 && /^[A-Z]+$/.test(word)) {
      // Common abbreviations that are NOT allowed
      const disallowedAbbrevs = ['USA', 'UK', 'US', 'EU', 'UN', 'WHO', 'WTO', 'IMF', 'FBI', 'CIA'];
      if (disallowedAbbrevs.includes(word)) {
        return true;
      }
    }
  } else if (language === 'ru') {
    if (ALLOWED_RUSSIAN_ABBREVIATIONS.has(word)) {
      return false; // Allowed abbreviation
    }
    // Russian abbreviations often contain periods or are very short
    // Check for common patterns
    if (word.length <= 4 && /^[А-ЯЁ]+$/.test(word)) {
      const disallowedAbbrevs = ['СССР', 'РФ', 'США', 'ЕС', 'ООН', 'ВОЗ', 'ВТО', 'МВФ'];
      if (disallowedAbbrevs.includes(word)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Validate if a word should be included in Scrabble dictionary
 */
function isValidScrabbleWord(word, language, pos = null) {
  // Basic length check
  if (!word || word.length < 2 || word.length > 15) {
    return { valid: false, reason: 'invalid_length' };
  }
  
  // Check for proper nouns
  if (language === 'en' && isLikelyProperNounEN(word)) {
    return { valid: false, reason: 'proper_noun' };
  }
  if (language === 'ru' && isLikelyProperNounRU(word)) {
    return { valid: false, reason: 'proper_noun' };
  }
  
  // Check for abbreviations
  if (isLikelyAbbreviation(word, language)) {
    return { valid: false, reason: 'abbreviation' };
  }
  
  return { valid: true };
}

/**
 * Parse SOWPODS word list (English)
 * SOWPODS is already curated for Scrabble, but we add extra validation
 */
async function parseSowpods() {
  const filePath = path.join(RAW_DIR, 'sowpods.txt');
  if (!fs.existsSync(filePath)) {
    throw new Error(`SOWPODS file not found: ${filePath}`);
  }

  console.log('Parsing SOWPODS word list...');
  const dict = new Map();
  const stats = {
    total: 0,
    valid: 0,
    filtered: {
      proper_noun: 0,
      abbreviation: 0,
      invalid_length: 0
    }
  };
  
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const word = line.trim().toUpperCase();
    stats.total++;
    
    if (word && word.length >= 2 && /^[A-Z]+$/.test(word)) {
      const validation = isValidScrabbleWord(word, 'en');
      if (validation.valid) {
        dict.set(word, { word });
        stats.valid++;
      } else {
        stats.filtered[validation.reason] = (stats.filtered[validation.reason] || 0) + 1;
      }
    } else {
      stats.filtered.invalid_length++;
    }
  }

  console.log(`✓ Parsed ${stats.valid} English words from SOWPODS (${stats.total} total)`);
  if (stats.filtered.proper_noun > 0) {
    console.log(`  Filtered ${stats.filtered.proper_noun} proper nouns`);
  }
  if (stats.filtered.abbreviation > 0) {
    console.log(`  Filtered ${stats.filtered.abbreviation} abbreviations`);
  }
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
 * 
 * IMPORTANT: There is no official public Russian Scrabble dictionary.
 * OpenRussian is a general dictionary, so we filter out proper nouns and abbreviations.
 * 
 * Word Forms: We include all inflected forms (cases, conjugations) from OpenRussian.
 * While one source suggests words should be in "nominative singular form," there's no
 * definitive official rule. Including all forms makes the dictionary more comprehensive.
 * If official rules are found that restrict word forms, this can be adjusted.
 * 
 * See RUSSIAN_SCRABBLE_RESEARCH.md for detailed research.
 */
async function parseRussianCSV(filename, posTag) {
  const filePath = path.join(RAW_DIR, `ru-${filename}`);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} not found, skipping...`);
    return new Map();
  }

  console.log(`Parsing ${filename}...`);
  const dict = new Map();
  const stats = {
    total: 0,
    valid: 0,
    filtered: {
      proper_noun: 0,
      abbreviation: 0,
      invalid_length: 0
    }
  };
  
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  
  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // Skip header
    stats.total++;
    
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
    
    // Validate according to Scrabble rules
    const validation = isValidScrabbleWord(cleaned, 'ru', posTag);
    if (!validation.valid) {
      stats.filtered[validation.reason] = (stats.filtered[validation.reason] || 0) + 1;
      continue;
    }
    
    // Also check for plural forms in the CSV (columns 11-16 are singular forms, 17-22 are plural)
    // We include all inflected forms as there's no definitive rule excluding them
    const forms = [];
    if (parts.length > 11) {
      // Singular forms (columns 11-16: sg_nom, sg_gen, sg_dat, sg_acc, sg_inst, sg_prep)
      for (let i = 11; i <= 16 && i < parts.length; i++) {
        const form = parts[i]?.trim().toUpperCase().replace(/[^А-ЯЁ]/g, '');
        if (form && form.length >= 2 && form !== cleaned) {
          // Validate inflected forms too (but don't count filtered ones in stats to avoid double-counting)
          const formValidation = isValidScrabbleWord(form, 'ru', posTag);
          if (formValidation.valid) {
            forms.push(form);
          }
        }
      }
      // Plural forms (columns 17-22: pl_nom, pl_gen, pl_dat, pl_acc, pl_inst, pl_prep)
      for (let i = 17; i <= 22 && i < parts.length; i++) {
        const form = parts[i]?.trim().toUpperCase().replace(/[^А-ЯЁ]/g, '');
        if (form && form.length >= 2 && form !== cleaned) {
          // Validate inflected forms too
          const formValidation = isValidScrabbleWord(form, 'ru', posTag);
          if (formValidation.valid) {
            forms.push(form);
          }
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
      stats.valid++;
    }
  }

  console.log(`✓ Parsed ${stats.valid} words from ${filename} (${stats.total} total)`);
  if (stats.filtered.proper_noun > 0) {
    console.log(`  Filtered ${stats.filtered.proper_noun} proper nouns`);
  }
  if (stats.filtered.abbreviation > 0) {
    console.log(`  Filtered ${stats.filtered.abbreviation} abbreviations`);
  }
  return dict;
}

/**
 * Parse Russian dictionary with strict form filtering
 * For nouns: only nominative singular + plural nominative
 * For other POS: only initial/base forms (no inflections)
 */
async function parseRussianCSVStrict(filename, posTag) {
  const filePath = path.join(RAW_DIR, `ru-${filename}`);
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} not found, skipping...`);
    return new Map();
  }

  console.log(`Parsing ${filename} (strict mode)...`);
  const dict = new Map();
  const stats = {
    total: 0,
    valid: 0,
    filtered: {
      proper_noun: 0,
      abbreviation: 0,
      invalid_length: 0
    }
  };
  
  const fileStream = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  
  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue; // Skip header
    stats.total++;
    
    const parts = line.split('\t');
    if (parts.length < 1) continue;
    
    const bareWord = parts[0]?.trim();
    if (!bareWord || bareWord.length < 2) continue;
    
    const word = bareWord.toUpperCase();
    const cleaned = word.replace(/[^А-ЯЁ]/g, '');
    if (!cleaned || cleaned.length < 2) continue;
    
    // Validate base word
    const validation = isValidScrabbleWord(cleaned, 'ru', posTag);
    if (!validation.valid) {
      stats.filtered[validation.reason] = (stats.filtered[validation.reason] || 0) + 1;
      continue;
    }
    
    const entry = {
      word: cleaned,
      pos: [posTag],
    };
    
    // For nouns: include only nominative singular (base) + plural nominative
    if (posTag === 'noun' && parts.length > 17) {
      const pluralNom = parts[17]?.trim().toUpperCase().replace(/[^А-ЯЁ]/g, '');
      if (pluralNom && pluralNom.length >= 2 && pluralNom !== cleaned) {
        const pluralValidation = isValidScrabbleWord(pluralNom, 'ru', posTag);
        if (pluralValidation.valid) {
          entry.plural = pluralNom;
        }
      }
    }
    // For other POS (verbs, adjectives, others): keep only base form
    // No inflected forms are included
    
    const existing = dict.get(cleaned);
    if (existing) {
      // Merge POS tags
      if (!existing.pos) existing.pos = [];
      if (!existing.pos.includes(posTag)) {
        existing.pos.push(posTag);
      }
      // Merge plural if it's a noun
      if (posTag === 'noun' && entry.plural && !existing.plural) {
        existing.plural = entry.plural;
      }
    } else {
      dict.set(cleaned, entry);
      stats.valid++;
    }
  }

  console.log(`✓ Parsed ${stats.valid} words from ${filename} (strict mode, ${stats.total} total)`);
  if (stats.filtered.proper_noun > 0) {
    console.log(`  Filtered ${stats.filtered.proper_noun} proper nouns`);
  }
  if (stats.filtered.abbreviation > 0) {
    console.log(`  Filtered ${stats.filtered.abbreviation} abbreviations`);
  }
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
 * Parse Russian dictionary with strict form filtering
 * Nouns: only nominative singular + plural nominative
 * Other POS: only initial/base forms
 */
async function parseRussianStrict() {
  console.log('\nParsing Russian dictionaries (strict mode)...\n');
  
  const nouns = await parseRussianCSVStrict('nouns.csv', 'noun');
  const verbs = await parseRussianCSVStrict('verbs.csv', 'verb');
  const adjectives = await parseRussianCSVStrict('adjectives.csv', 'adj');
  const others = await parseRussianCSVStrict('others.csv', 'other');
  
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
        // Merge plural if it's a noun
        if (entry.plural && !existing.plural) {
          existing.plural = entry.plural;
        }
      } else {
        merged.set(word, { ...entry });
      }
    }
  }
  
  console.log(`\n✓ Total Russian words (strict): ${merged.size}`);
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
function saveDictionary(language, dict, suffix = '') {
  const json = dictToJSON(dict);
  const filename = suffix ? `${language}-${suffix}.json` : `${language}.json`;
  const outputPath = path.join(OUTPUT_DIR, filename);
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
    
    // Parse Russian (full version with all inflected forms)
    console.log('\n=== Processing Russian Dictionary (Full) ===\n');
    const russianDict = await parseRussian();
    saveDictionary('ru', russianDict);
    
    // Parse Russian (strict version: nouns nominative+plural only, others base forms only)
    console.log('\n=== Processing Russian Dictionary (Strict) ===\n');
    const russianDictStrict = await parseRussianStrict();
    saveDictionary('ru', russianDictStrict, 'strict');
    
    console.log('\n=== Parsing Complete ===');
    console.log(`\nDictionaries saved to: ${OUTPUT_DIR}`);
    console.log('\nRussian dictionaries:');
    console.log('  - ru.json: Full version with all inflected forms');
    console.log('  - ru-strict.json: Strict version (nouns: nominative+plural only, others: base forms only)');
    console.log('\nThe dictionaries are now ready to use in the application.\n');
  } catch (error) {
    console.error('\nError:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
