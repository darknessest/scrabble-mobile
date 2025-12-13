import type { Language, Tile } from './types';

interface TileSpec {
  letter: string;
  count: number;
  value: number;
}

const ENGLISH_SET: TileSpec[] = [
  { letter: 'A', count: 9, value: 1 },
  { letter: 'B', count: 2, value: 3 },
  { letter: 'C', count: 2, value: 3 },
  { letter: 'D', count: 4, value: 2 },
  { letter: 'E', count: 12, value: 1 },
  { letter: 'F', count: 2, value: 4 },
  { letter: 'G', count: 3, value: 2 },
  { letter: 'H', count: 2, value: 4 },
  { letter: 'I', count: 9, value: 1 },
  { letter: 'J', count: 1, value: 8 },
  { letter: 'K', count: 1, value: 5 },
  { letter: 'L', count: 4, value: 1 },
  { letter: 'M', count: 2, value: 3 },
  { letter: 'N', count: 6, value: 1 },
  { letter: 'O', count: 8, value: 1 },
  { letter: 'P', count: 2, value: 3 },
  { letter: 'Q', count: 1, value: 10 },
  { letter: 'R', count: 6, value: 1 },
  { letter: 'S', count: 4, value: 1 },
  { letter: 'T', count: 6, value: 1 },
  { letter: 'U', count: 4, value: 1 },
  { letter: 'V', count: 2, value: 4 },
  { letter: 'W', count: 2, value: 4 },
  { letter: 'X', count: 1, value: 8 },
  { letter: 'Y', count: 2, value: 4 },
  { letter: 'Z', count: 1, value: 10 },
  { letter: ' ', count: 2, value: 0 }
];

// Russian (Scrabble set 104 tiles)
const RUSSIAN_SET: TileSpec[] = [
  { letter: 'А', count: 8, value: 1 },
  { letter: 'Б', count: 2, value: 3 },
  { letter: 'В', count: 4, value: 1 },
  { letter: 'Г', count: 2, value: 3 },
  { letter: 'Д', count: 4, value: 2 },
  { letter: 'Е', count: 8, value: 1 },
  { letter: 'Ё', count: 1, value: 3 },
  { letter: 'Ж', count: 1, value: 5 },
  { letter: 'З', count: 2, value: 5 },
  { letter: 'И', count: 5, value: 1 },
  { letter: 'Й', count: 1, value: 4 },
  { letter: 'К', count: 4, value: 2 },
  { letter: 'Л', count: 4, value: 2 },
  { letter: 'М', count: 3, value: 2 },
  { letter: 'Н', count: 5, value: 1 },
  { letter: 'О', count: 10, value: 1 },
  { letter: 'П', count: 4, value: 2 },
  { letter: 'Р', count: 5, value: 1 },
  { letter: 'С', count: 5, value: 1 },
  { letter: 'Т', count: 5, value: 1 },
  { letter: 'У', count: 4, value: 2 },
  { letter: 'Ф', count: 1, value: 10 },
  { letter: 'Х', count: 1, value: 5 },
  { letter: 'Ц', count: 1, value: 5 },
  { letter: 'Ч', count: 1, value: 5 },
  { letter: 'Ш', count: 1, value: 8 },
  { letter: 'Щ', count: 1, value: 10 },
  { letter: 'Ъ', count: 1, value: 10 },
  { letter: 'Ы', count: 2, value: 4 },
  { letter: 'Ь', count: 2, value: 2 },
  { letter: 'Э', count: 1, value: 8 },
  { letter: 'Ю', count: 1, value: 8 },
  { letter: 'Я', count: 2, value: 3 },
  { letter: ' ', count: 2, value: 0 }
];

function specsFor(language: Language): TileSpec[] {
  return language === 'en' ? ENGLISH_SET : RUSSIAN_SET;
}

export function getInitialBagSize(language: Language): number {
  return specsFor(language).reduce((sum, spec) => sum + spec.count, 0);
}

export function buildBag(language: Language): Tile[] {
  const specs = specsFor(language);
  const tiles: Tile[] = [];
  specs.forEach((spec) => {
    for (let i = 0; i < spec.count; i += 1) {
      tiles.push({
        id: crypto.randomUUID(),
        letter: spec.letter,
        value: spec.value,
        blank: spec.letter === ' '
      });
    }
  });
  return shuffle(tiles);
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

