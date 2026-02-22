// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dictionary/dictionaryService', () => ({
  ensureDictionary: vi.fn(),
  ensureDictionaryStrict: vi.fn(),
  getDictionaryWordSet: vi.fn(),
  downloadDictionary: vi.fn(),
  downloadDictionaryStrict: vi.fn()
}));

const dictionaryService = await import('../dictionary/dictionaryService');
const dictionaryControllerModule = await import('./dictionaryController');
const { DictionaryController } = dictionaryControllerModule;
const ensureDictionary = vi.mocked(dictionaryService.ensureDictionary);
const ensureDictionaryStrict = vi.mocked(dictionaryService.ensureDictionaryStrict);
const getDictionaryWordSet = vi.mocked(dictionaryService.getDictionaryWordSet);

function makeController() {
  const dictEnIcon = document.createElement('span');
  const dictRuIcon = document.createElement('span');
  const dictRuStrictIcon = document.createElement('span');
  const dictStatus = document.createElement('span');
  const appendLog = vi.fn<(msg: string) => void>();

  return {
    controller: new DictionaryController(
      dictEnIcon,
      dictRuIcon,
      dictRuStrictIcon,
      dictStatus,
      appendLog
    ),
    appendLog
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureDictionary.mockReset();
  ensureDictionaryStrict.mockReset();
  getDictionaryWordSet.mockReset();
});

describe('DictionaryController', () => {
  it('uses strict dictionary branch for ru strict variants', async () => {
    ensureDictionaryStrict.mockResolvedValue({ language: 'ru', available: true, source: 'indexeddb' });
    getDictionaryWordSet.mockResolvedValue(new Set(['ТЕСТ', 'ДЕЛА']));

    const { controller } = makeController();
    const result = await controller.hasWordWithVariant(' тест ', 'ru', 'strict');

    expect(result).toBe(true);
    expect(ensureDictionaryStrict).toHaveBeenCalledTimes(1);
    expect(getDictionaryWordSet).toHaveBeenCalledWith('ru-strict');
    expect(ensureDictionary).not.toHaveBeenCalled();
  });

  it('returns false for strict russian when strict dictionary is unavailable', async () => {
    ensureDictionaryStrict.mockResolvedValue({ language: 'ru', available: false });

    const { controller } = makeController();
    const result = await controller.hasWordWithVariant('тест', 'ru', 'strict');

    expect(result).toBe(false);
    expect(ensureDictionaryStrict).toHaveBeenCalled();
    expect(getDictionaryWordSet).not.toHaveBeenCalled();
  });

  it('uses full russian dictionary branch when variant is full', async () => {
    ensureDictionary.mockResolvedValue({ language: 'ru', available: true, source: 'indexeddb' });
    getDictionaryWordSet.mockResolvedValue(new Set(['СЛОН', 'ПОРОСЕЦ']));
    const { controller } = makeController();
    const minLengthInput = document.createElement('input');
    minLengthInput.value = '5';

    const shortWord = await controller.hasWordWithVariant('СЛОН', 'ru', 'full', minLengthInput);
    const longWord = await controller.hasWordWithVariant('ПОРОСЕЦ', 'ru', 'full', minLengthInput);

    expect(shortWord).toBe(false);
    expect(longWord).toBe(true);
    expect(ensureDictionary).toHaveBeenCalledWith('ru');
    expect(ensureDictionaryStrict).not.toHaveBeenCalled();
    expect(getDictionaryWordSet).toHaveBeenCalledWith('ru');
  });
});
