import type { Language } from '../core/types';
import {
    downloadDictionary,
    downloadDictionaryStrict,
    ensureDictionary,
    ensureDictionaryStrict,
    getDictionaryWordSet
} from '../dictionary/dictionaryService';

export class DictionaryController {
    private dictEnIcon: HTMLSpanElement;
    private dictRuIcon: HTMLSpanElement;
    private dictRuStrictIcon: HTMLSpanElement;
    private dictStatus: HTMLSpanElement;
    private appendLog: (msg: string) => void;

    constructor(
        dictEnIcon: HTMLSpanElement,
        dictRuIcon: HTMLSpanElement,
        dictRuStrictIcon: HTMLSpanElement,
        dictStatus: HTMLSpanElement,
        appendLog: (msg: string) => void
    ) {
        this.dictEnIcon = dictEnIcon;
        this.dictRuIcon = dictRuIcon;
        this.dictRuStrictIcon = dictRuStrictIcon;
        this.dictStatus = dictStatus;
        this.appendLog = appendLog;
    }

    async refreshDictStatus(): Promise<void> {
        const [en, ru, ruStrict] = await Promise.all([
            ensureDictionary('en'),
            ensureDictionary('ru'),
            ensureDictionaryStrict()
        ]);
        const icon = (available: boolean) => (available ? '✅' : '❌');

        const ruAvailable = ru.available || ruStrict.available;
        this.dictStatus.textContent = `EN ${icon(en.available)} • RU ${icon(ruAvailable)}`;
        this.dictStatus.classList.toggle('danger', !en.available || !ruAvailable);

        this.dictEnIcon.textContent = icon(en.available);
        this.dictRuIcon.textContent = icon(ru.available);
        this.dictRuStrictIcon.textContent = icon(ruStrict.available);
    }

    startDictionaryAutoCheck(): void {
        window.addEventListener('focus', () => void this.refreshDictStatus());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) void this.refreshDictStatus();
        });
        window.setInterval(() => void this.refreshDictStatus(), 30_000);
    }

    async ensureLanguage(language: Language): Promise<void> {
        const status = await ensureDictionary(language);
        if (!status.available) {
            this.appendLog(`Dictionary ${language} missing. Prompting download.`);
            await this.downloadLanguage(language);
        }
        await this.refreshDictStatus();
    }

    async downloadLanguage(language: Language): Promise<void> {
        const result = await downloadDictionary(language);
        if (result.available) {
            this.appendLog(`Downloaded ${language.toUpperCase()} dictionary (${result.words ?? '?'} words)`);
        } else {
            this.appendLog(`Failed to download ${language} dictionary`);
        }
        await this.refreshDictStatus();
    }

    async downloadRuStrict(): Promise<void> {
        const result = await downloadDictionaryStrict();
        if (result.available) {
            this.appendLog(`Downloaded RU strict dictionary (${result.words ?? '?'} words)`);
        } else {
            this.appendLog(`Failed to download RU strict dictionary`);
        }
        await this.refreshDictStatus();
    }

    async hasWordWithVariant(
        word: string,
        language: Language,
        variant?: 'full' | 'strict',
        minLengthInput?: HTMLInputElement
    ): Promise<boolean> {
        if (language === 'ru' && variant === 'strict') {
            const strictStatus = await ensureDictionaryStrict();
            if (!strictStatus.available) return false;
            const norm = word.trim().toUpperCase();
            const minLength = minLengthInput ? Math.max(1, Math.floor(Number(minLengthInput.value) || 2)) : 2;
            if (norm.length < minLength) return false;
            const cache = await getDictionaryWordSet('ru-strict');
            return cache?.has(norm) ?? false;
        } else if (language === 'ru' && variant === 'full') {
            const status = await ensureDictionary(language);
            if (!status.available) return false;
            const norm = word.trim().toUpperCase();
            const minLength = minLengthInput ? Math.max(1, Math.floor(Number(minLengthInput.value) || 2)) : 2;
            if (norm.length < minLength) return false;
            const cache = await getDictionaryWordSet(language);
            return cache?.has(norm) ?? false;
        }
        return false;
    }
}
