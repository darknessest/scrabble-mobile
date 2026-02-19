import type { Language, Tile } from '../core/types';

export class BlankTileSelector {

  constructor(_appendLog: (msg: string) => void) {
    // Append log is managed externally
  }

  selectBlankLetter(tile: Tile, language: Language): Promise<Tile | null> {
    return new Promise((resolve) => {
      const letters = language === 'en'
        ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        : 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      `;

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'blank-dialog-title');
      dialog.style.cssText = `
        background: #1e293b;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 16px;
        padding: 24px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
      `;

      dialog.innerHTML = `
        <h3 id="blank-dialog-title" style="margin: 0 0 12px 0; color: #f1f5f9; font-size: 1.25rem; font-weight: 600;">Choose blank tile letter</h3>
        <p style="margin: 0 0 20px 0; color: #94a3b8; font-size: 0.9rem;">Select which letter this blank tile will represent:</p>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 8px; margin-bottom: 20px;">
          ${letters.split('').map(letter => `
            <button class="blank-letter-btn" data-letter="${letter}" aria-label="${letter}" style="
              padding: 10px 8px;
              border: 1px solid rgba(148, 163, 184, 0.2);
              border-radius: 8px;
              background: linear-gradient(145deg, #fef3c7 0%, #fde68a 50%, #fcd34d 100%);
              color: #1c1917;
              cursor: pointer;
              font-weight: 700;
              font-size: 16px;
              transition: all 0.15s;
              box-shadow: inset 0 -2px 0 #b45309, 0 2px 4px rgba(0,0,0,0.2);
            " onmouseover="this.style.transform='translateY(-2px) scale(1.05)'; this.style.boxShadow='0 0 0 2px #3b82f6, inset 0 -2px 0 #b45309, 0 4px 8px rgba(0,0,0,0.3)'"
               onmouseout="this.style.transform=''; this.style.boxShadow='inset 0 -2px 0 #b45309, 0 2px 4px rgba(0,0,0,0.2)'">
              ${letter}
            </button>
          `).join('')}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="cancel-blank" style="
            padding: 10px 20px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 10px;
            background: #334155;
            color: #f1f5f9;
            cursor: pointer;
            font-weight: 600;
            font-size: 0.9rem;
            transition: all 0.15s;
          " onmouseover="this.style.background='#475569'" onmouseout="this.style.background='#334155'">Cancel</button>
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
