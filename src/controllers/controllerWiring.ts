import type { UiElements } from '../ui/uiRenderer';
import type { AdditionalElements } from '../ui/domElements';
import type { SessionMeta } from '../types';
import { ToastManager } from '../ui/toast';
import { QrScanner } from '../ui/qrScanner';
import { BlankTileSelector } from '../ui/blankTileSelector';
import { GameController } from './gameController';
import { NetworkController } from './networkController';
import { TimerController } from './timerController';
import { DictionaryController } from './dictionaryController';
import { StorageController } from './storageController';
import { ReadyGate } from './readyGate';
import { GameOverController } from './gameOver';
import { EndgameScanController } from './endgameScan';

export interface Controllers {
  toastManager: ToastManager;
  qrScanner: QrScanner;
  blankTileSelector: BlankTileSelector;
  gameController: GameController;
  networkController: NetworkController;
  timerController: TimerController;
  dictionaryController: DictionaryController;
  storageController: StorageController;
  readyGate: ReadyGate;
  gameOverController: GameOverController;
  endgameScanController: EndgameScanController;
}

export function createControllers(
  uiElements: UiElements,
  additional: AdditionalElements,
  appendLog: (msg: string) => void
): Controllers {
  const toastManager = new ToastManager(additional.toastEl);
  const qrScanner = new QrScanner(appendLog);
  const blankTileSelector = new BlankTileSelector();
  const gameController = new GameController(appendLog, toastManager.showToast.bind(toastManager));
  const networkController = new NetworkController(
    uiElements.p2pStatus,
    additional.offerText,
    additional.offerQr,
    additional.answerText,
    additional.hostOfferInput,
    additional.clientAnswer,
    additional.answerQr,
    uiElements.disconnectOverlay,
    uiElements.disconnectMessage,
    appendLog
  );
  const timerController = new TimerController(uiElements.timerDisplay);
  const dictionaryController = new DictionaryController(
    additional.dictEnIcon,
    additional.dictRuIcon,
    additional.dictRuStrictIcon,
    uiElements.dictStatus,
    appendLog
  );
  const storageController = new StorageController(
    additional.resumeBtn,
    additional.clearSnapshotBtn,
    additional.resumeNote
  );
  const readyGate = new ReadyGate(
    uiElements.readyOverlay,
    uiElements.readyStatusEl,
    uiElements.readyBtn
  );
  const gameOverController = new GameOverController(
    uiElements.gameOverOverlay,
    uiElements.gameOverReasonEl,
    uiElements.gameOverScoresEl,
    uiElements.gameOverStatsEl,
    uiElements.rematchStatusEl,
    uiElements.rematchBtnOverlay,
    uiElements.gameOverBanner,
    uiElements.gameOverBannerScoresEl,
    uiElements.rematchBannerStatusEl,
    uiElements.rematchBtnBanner
  );
  const endgameScanController = new EndgameScanController(
    uiElements.endgameScanStatus,
    appendLog
  );

  return {
    toastManager,
    qrScanner,
    blankTileSelector,
    gameController,
    networkController,
    timerController,
    dictionaryController,
    storageController,
    readyGate,
    gameOverController,
    endgameScanController
  };
}

export interface WireCallbacksDeps {
  getMeta(): SessionMeta | null;
  getLabels(): Record<string, string>;
  updateValidationUI(): void;
  applyActionButtonsState(): void;
  checkAndHandleGameEnd(): void;
  handleEndgameScanComplete(): void;
  renderAll(): void;
  sendSync(): void;
  sendDraftPlacements(): void;
  handleMessage(data: unknown): Promise<void>;
  appendLog(msg: string): void;
}

export function wireCallbacks(c: Controllers, deps: WireCallbacksDeps): void {
  const {
    gameController, networkController, timerController,
    endgameScanController, storageController, readyGate
  } = c;

  gameController.setOnValidationUpdate(() => {
    deps.updateValidationUI();
    deps.applyActionButtonsState();
  });
  gameController.setOnGameEnd(() => {
    deps.checkAndHandleGameEnd();
  });
  gameController.setOnPersist(async () => {
    await storageController.persistSnapshot(
      gameController.getState(),
      deps.getMeta(),
      deps.getLabels()
    );
  });
  gameController.setOnSync(() => {
    deps.sendSync();
    deps.sendDraftPlacements();
  });
  gameController.setOnRenderAll(() => {
    deps.renderAll();
  });

  readyGate.setOnUnlock(() => {
    deps.renderAll();
  });

  timerController.setOnTimeout(() => {
    void gameController.maybeAutoPassOnTimeout();
  });

  networkController.setOnMessage((data: unknown) => {
    void deps.handleMessage(data);
  });
  networkController.setOnOpen(() => {
    const meta = deps.getMeta();
    if (meta?.isHost && gameController.getState()) {
      if (meta.timerEnabled && meta.timerDurationSec && !meta.turnDeadline && !readyGate.isPreGameLocked()) {
        timerController.resetTurnTimer(readyGate.isPreGameLocked.bind(readyGate));
        void storageController.persistSnapshot(
          gameController.getState(),
          meta,
          deps.getLabels()
        );
      }
      deps.appendLog('Host: sending sync to peer.');
      deps.sendSync();
    } else {
      deps.appendLog('Client: requesting sync from host.');
      networkController.send({ type: 'REQUEST_SYNC' });
    }
  });
  networkController.setOnClose(() => {
    // Handled internally
  });
  networkController.setOnError((err: unknown) => {
    deps.appendLog(`P2P error: ${String(err)}`);
  });
  networkController.setOnConnectionStateChange(() => {
    // Handled internally
  });

  endgameScanController.setOnGameEnd(() => {
    deps.handleEndgameScanComplete();
  });
}
