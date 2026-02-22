import type { Language, Tile } from '../core/types';

export class BlankTileSelector {

  constructor() {
  }

  selectBlankLetter(tile: Tile, language: Language): Promise<Tile | null> {
    return new Promise((resolve) => {
      const letters = language === 'en'
        ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        : 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
      const focusedBoardCell = document.activeElement?.closest?.('[data-x][data-y]') as HTMLElement | null;

      const modal = document.createElement('div');
      modal.className = 'blank-modal-overlay';

      const dialog = document.createElement('div');
      dialog.className = 'blank-modal-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'blank-dialog-title');

      dialog.innerHTML = `
        <h3 id="blank-dialog-title" class="blank-dialog-title">Choose blank tile letter</h3>
        <p class="blank-dialog-description">Select which letter this blank tile will represent:</p>
        <div class="blank-letter-grid">
          ${letters.split('').map(letter => `
            <button class="blank-letter-btn" data-letter="${letter}" aria-label="${letter}" type="button">
              ${letter}
            </button>
          `).join('')}
        </div>
        <div class="blank-dialog-actions">
          <button id="cancel-blank" class="blank-cancel-btn" type="button">Cancel</button>
        </div>
      `;

      modal.appendChild(dialog);
      document.body.appendChild(modal);

      // Move focus into dialog
      const firstBtn = dialog.querySelector<HTMLButtonElement>('button');
      firstBtn?.focus();

      // Focus trap: keep Tab cycling within the dialog
      const handleFocusTrap = (ev: KeyboardEvent) => {
        if (ev.key !== 'Tab') return;
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (ev.shiftKey) {
          if (document.activeElement === first) { ev.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { ev.preventDefault(); first.focus(); }
        }
      };
      document.addEventListener('keydown', handleFocusTrap);

      const cleanup = () => {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', handleEscape);
        document.removeEventListener('keydown', handleFocusTrap);
        if (focusedBoardCell && document.body.contains(focusedBoardCell)) {
          focusedBoardCell.focus();
        }
      };

      const handleEscape = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') { cleanup(); resolve(null); }
      };
      document.addEventListener('keydown', handleEscape);

      dialog.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement;
        if (target.classList.contains('blank-letter-btn')) {
          const letter = target.dataset.letter!;
          const updatedTile: Tile = { ...tile, letter, value: 0 };
          cleanup();
          resolve(updatedTile);
        } else if (target.id === 'cancel-blank') {
          cleanup();
          resolve(null);
        }
      });
    });
  }
}
