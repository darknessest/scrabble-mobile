# Russian Scrabble Research Summary

## Key Findings

### Official Dictionary Status
**There is NO universally recognized official Russian Scrabble dictionary available publicly.**

Unlike English Scrabble which has:
- **SOWPODS** (official international word list)
- **NWL/OSPD** (North American word lists)

Russian Scrabble (known as "Эрудит" / "Erudit") does not have a standardized public dictionary.

### What Players Use Instead

Players typically rely on general Russian language dictionaries:
- **Ushakov's Dictionary** (Толковый словарь Ушакова) - ~90,000 entries, published 1935-1940
- **Oxford Russian Dictionary** - Bilingual dictionary
- **Multitran** - Online multilingual dictionary (~10M+ terms)

### Word Forms Question

**Unclear whether all inflected forms are allowed:**

One source mentioned that words are "typically nouns in their nominative singular form," but this is not definitively stated as a rule. Russian has:
- 6 grammatical cases (nominative, genitive, dative, accusative, instrumental, prepositional)
- Plural forms for all cases
- Verb conjugations
- Adjective declensions

**Current Approach:**
- We include all inflected forms from OpenRussian
- This is reasonable since Russian Scrabble rules are not clearly defined
- Players can adjust via game settings if needed

### Tile Distribution

Russian Scrabble uses **104 tiles** with Cyrillic letters:
- Common letters (А, О, Е, И) have 8-10 tiles, worth 1 point
- Rare letters (Ф, Щ, Ъ) have 1 tile, worth 10 points
- Two blank tiles

### Filtering Requirements

Since we're using **OpenRussian** (a general dictionary, not Scrabble-specific), we need to filter:

1. **Proper Nouns** (definitely not allowed):
   - Personal names (Иван, Мария, Петров)
   - Place names (Москва, Санкт-Петербург, Россия)
   - Country names

2. **Abbreviations** (generally not allowed):
   - Unless they've become standard words (e.g., СССР might be acceptable in historical context, but modern abbreviations like РФ, США are not)

3. **Invalid Words**:
   - Too short (< 2 letters) or too long (> 15 letters)
   - Contains non-letter characters

### Recommendations

1. **Current filtering approach is reasonable** - we filter proper nouns and abbreviations
2. **Include all inflected forms** - until we find definitive rules saying otherwise
3. **Document the lack of official dictionary** - make it clear to users
4. **Consider making word form inclusion configurable** - allow users to choose base forms only vs. all forms

### Sources Consulted

- Wikipedia articles on Ushakov's Dictionary, Oxford Russian Dictionary, Multitran
- Various Scrabble rule resources
- Russian Scrabble tile distribution information
- General Russian language resources

### Implementation Status

1. ✅ Filter proper nouns (implemented) - filters common Russian names, surnames, cities, countries
2. ✅ Filter abbreviations (implemented) - filters abbreviations unless they've become standard words
3. ✅ Two dictionary versions created:
   - **Full version (`ru.json`)**: Includes all inflected forms (cases, conjugations, declensions)
   - **Strict version (`ru-strict.json`)**: Nouns in nominative singular + plural only; other POS in base forms only
4. ✅ Document the lack of official dictionary (implemented) - documented in README.md, DICTIONARIES.md, and parse-dicts.js
5. ✅ Strict version aligns with "nominative singular form" suggestion from research

### Current Implementation

The parsing script (`parse-dicts.js`) now generates two Russian dictionaries:

**Full Version (`ru.json`):**
- Validates all words (base forms and inflected forms) against Scrabble rules
- Includes all case forms, conjugations, and declensions
- Most comprehensive version

**Strict Version (`ru-strict.json`):**
- Same validation and filtering as full version
- **Nouns**: Only nominative singular (base form) + plural nominative
- **Verbs**: Only infinitive form (no conjugations)
- **Adjectives**: Only nominative singular masculine (no declensions)
- **Others**: Only base/initial forms (no inflections)
- Aligns with the "nominative singular form" suggestion found in research

Both versions:
- Filter out proper nouns using explicit lists (more reliable than pattern matching)
- Filter out abbreviations (with exceptions for standard words)
- Include comprehensive documentation about the lack of official dictionary
- Provide statistics on filtered words during parsing

### Notes for Future

- If an official Russian Scrabble dictionary becomes available, we should switch to it
- If definitive rules are found about word forms, we can adjust the implementation
- The current approach (including all forms) is more permissive and comprehensive, which is reasonable given the lack of official rules

