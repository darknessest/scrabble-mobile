import type { Mode, SessionMeta } from './types';
import type { Controllers } from './controllers/controllerWiring';
import type { UiElements } from './ui/uiRenderer';
import type { AdditionalElements } from './ui/domElements';

export interface AppState {
  mode: Mode;
  meta: SessionMeta | null;
  labels: Record<string, string>;
  settingsHidden: boolean;
  logsHidden: boolean;
  lastShownTurnEventToken: string | null;
}

export interface App {
  state: AppState;
  controllers: Controllers;
  uiElements: UiElements;
  additional: AdditionalElements;
  appendLog(msg: string): void;
  showToast(msg: string, variant?: 'info' | 'danger', ms?: number): void;
  renderAll(): void;
  sendSync(): void;
  checkAndHandleGameEnd(): void;
  markLocalReady(): void;
  maybeShowTimeoutToastFromMeta(m: SessionMeta): void;
  applyModeUIInternal(): void;
  applyTimerInputFromMetaInternal(): void;
  applyMinLengthInputFromMetaInternal(): void;
  renderVisibilityInternal(): void;
  finalizeGameEnd(): Promise<void>;
}
