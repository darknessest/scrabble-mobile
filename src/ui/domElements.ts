import type { UiElements } from './uiRenderer';

export interface AdditionalElements {
  toastEl: HTMLDivElement;
  copyOfferBtn: HTMLButtonElement;
  offerText: HTMLTextAreaElement;
  offerQr: HTMLImageElement;
  answerText: HTMLTextAreaElement;
  scanAnswerBtn: HTMLButtonElement;
  hostOfferInput: HTMLTextAreaElement;
  scanOfferBtn: HTMLButtonElement;
  clientAnswer: HTMLTextAreaElement;
  copyClientAnswerBtn: HTMLButtonElement;
  answerQr: HTMLImageElement;
  refreshDictsBtn: HTMLButtonElement;
  downloadEnBtn: HTMLButtonElement;
  downloadRuBtn: HTMLButtonElement;
  downloadRuStrictBtn: HTMLButtonElement;
  dictEnIcon: HTMLSpanElement;
  dictRuIcon: HTMLSpanElement;
  dictRuStrictIcon: HTMLSpanElement;
  requestSyncBtn: HTMLButtonElement;
  toggleSetupBtn: HTMLButtonElement;
  toggleLogsBtn: HTMLButtonElement;
  startBtn: HTMLButtonElement;
  resumeBtn: HTMLButtonElement;
  clearSnapshotBtn: HTMLButtonElement;
  resumeNote: HTMLParagraphElement;
  forceReloadBtn: HTMLButtonElement;
}

export function getUiElements(): UiElements {
  return {
    boardEl: document.querySelector<HTMLDivElement>('#board')!,
    rackEl: document.querySelector<HTMLDivElement>('#rack')!,
    rackOwnerEl: document.querySelector<HTMLSpanElement>('#rack-owner')!,
    turnIndicator: document.querySelector<HTMLSpanElement>('#turn-indicator')!,
    timerDisplay: document.querySelector<HTMLSpanElement>('#timer-display')!,
    wordCheckStatus: document.querySelector<HTMLSpanElement>('#word-check-status')!,
    wordLengthStatus: document.querySelector<HTMLSpanElement>('#word-length-status')!,
    endgameScanStatus: document.querySelector<HTMLSpanElement>('#endgame-scan-status')!,
    scoresEl: document.querySelector<HTMLDivElement>('#scores')!,
    logEl: document.querySelector<HTMLDivElement>('#log')!,
    bagCountEl: document.querySelector<HTMLElement>('#bag-count')!,
    moveHistoryEl: document.querySelector<HTMLDivElement>('#move-history')!,
    settingsSection: document.querySelector<HTMLElement>('#settings-section')!,
    confirmMoveBtn: document.querySelector<HTMLButtonElement>('#confirm-move')!,
    passBtn: document.querySelector<HTMLButtonElement>('#pass-btn')!,
    exchangeBtn: document.querySelector<HTMLButtonElement>('#exchange-btn')!,
    clearPlacementsBtn: document.querySelector<HTMLButtonElement>('#clear-placements')!,
    mixRackBtn: document.querySelector<HTMLButtonElement>('#mix-rack')!,
    languageSelect: document.querySelector<HTMLSelectElement>('#language')!,
    russianVariantSelect: document.querySelector<HTMLSelectElement>('#russian-dict-variant')!,
    russianVariantWrapper: document.querySelector<HTMLElement>('#russian-variant')!,
    minLengthInput: document.querySelector<HTMLInputElement>('#min-length')!,
    timerEnabledToggle: document.querySelector<HTMLInputElement>('#turn-timer-enabled')!,
    timerMinutesWrapper: document.querySelector<HTMLElement>('#turn-timer-minutes')!,
    timerInput: document.querySelector<HTMLInputElement>('#turn-timer')!,
    meInput: document.querySelector<HTMLInputElement>('#me-name')!,
    peerInput: document.querySelector<HTMLInputElement>('#peer-name')!,
    modeTabs: document.querySelector<HTMLDivElement>('#mode-tabs')!,
    hostCard: document.querySelector<HTMLDivElement>('#host-handshake')!,
    clientCard: document.querySelector<HTMLDivElement>('#client-handshake')!,
    languageWrapper: document.querySelector<HTMLElement>('#session-language')!,
    timerWrapper: document.querySelector<HTMLElement>('#session-timer')!,
    offlineStatus: document.querySelector<HTMLSpanElement>('#offline-status')!,
    dictStatus: document.querySelector<HTMLSpanElement>('#dict-status')!,
    p2pStatus: document.querySelector<HTMLSpanElement>('#p2p-status')!,
    versionEl: document.querySelector<HTMLParagraphElement>('#app-version'),
    readyOverlay: document.querySelector<HTMLDivElement>('#ready-overlay')!,
    readyStatusEl: document.querySelector<HTMLParagraphElement>('#ready-status')!,
    readyBtn: document.querySelector<HTMLButtonElement>('#ready-btn')!,
    gameOverOverlay: document.querySelector<HTMLDivElement>('#gameover-overlay')!,
    gameOverReasonEl: document.querySelector<HTMLParagraphElement>('#gameover-reason')!,
    gameOverScoresEl: document.querySelector<HTMLDivElement>('#gameover-scores')!,
    gameOverStatsEl: document.querySelector<HTMLDivElement>('#gameover-stats')!,
    rematchStatusEl: document.querySelector<HTMLParagraphElement>('#rematch-status')!,
    rematchBtnOverlay: document.querySelector<HTMLButtonElement>('#rematch-btn-overlay')!,
    viewBoardBtn: document.querySelector<HTMLButtonElement>('#view-board-btn')!,
    gameOverBanner: document.querySelector<HTMLDivElement>('#gameover-banner')!,
    gameOverBannerScoresEl: document.querySelector<HTMLSpanElement>('#gameover-banner-scores')!,
    rematchBannerStatusEl: document.querySelector<HTMLSpanElement>('#rematch-banner-status')!,
    rematchBtnBanner: document.querySelector<HTMLButtonElement>('#rematch-btn-banner')!,
    showResultsBtn: document.querySelector<HTMLButtonElement>('#show-results-btn')!,
    disconnectOverlay: document.querySelector<HTMLDivElement>('#disconnect-overlay')!,
    disconnectMessage: document.querySelector<HTMLParagraphElement>('#disconnect-message')!
  };
}

export function getAdditionalElements(): AdditionalElements {
  return {
    toastEl: document.querySelector<HTMLDivElement>('#toast')!,
    copyOfferBtn: document.querySelector<HTMLButtonElement>('#copy-offer')!,
    offerText: document.querySelector<HTMLTextAreaElement>('#offer-text')!,
    offerQr: document.querySelector<HTMLImageElement>('#offer-qr')!,
    answerText: document.querySelector<HTMLTextAreaElement>('#answer-text')!,
    scanAnswerBtn: document.querySelector<HTMLButtonElement>('#scan-answer')!,
    hostOfferInput: document.querySelector<HTMLTextAreaElement>('#host-offer-input')!,
    scanOfferBtn: document.querySelector<HTMLButtonElement>('#scan-offer')!,
    clientAnswer: document.querySelector<HTMLTextAreaElement>('#client-answer')!,
    copyClientAnswerBtn: document.querySelector<HTMLButtonElement>('#copy-client-answer')!,
    answerQr: document.querySelector<HTMLImageElement>('#answer-qr')!,
    refreshDictsBtn: document.querySelector<HTMLButtonElement>('#refresh-dicts')!,
    downloadEnBtn: document.querySelector<HTMLButtonElement>('#download-en')!,
    downloadRuBtn: document.querySelector<HTMLButtonElement>('#download-ru')!,
    downloadRuStrictBtn: document.querySelector<HTMLButtonElement>('#download-ru-strict')!,
    dictEnIcon: document.querySelector<HTMLSpanElement>('#dict-en-icon')!,
    dictRuIcon: document.querySelector<HTMLSpanElement>('#dict-ru-icon')!,
    dictRuStrictIcon: document.querySelector<HTMLSpanElement>('#dict-ru-strict-icon')!,
    requestSyncBtn: document.querySelector<HTMLButtonElement>('#request-sync')!,
    toggleSetupBtn: document.querySelector<HTMLButtonElement>('#toggle-setup')!,
    toggleLogsBtn: document.querySelector<HTMLButtonElement>('#toggle-logs')!,
    startBtn: document.querySelector<HTMLButtonElement>('#start-btn')!,
    resumeBtn: document.querySelector<HTMLButtonElement>('#resume-btn')!,
    clearSnapshotBtn: document.querySelector<HTMLButtonElement>('#clear-snapshot')!,
    resumeNote: document.querySelector<HTMLParagraphElement>('#resume-note')!,
    forceReloadBtn: document.querySelector<HTMLButtonElement>('#force-reload')!
  };
}
