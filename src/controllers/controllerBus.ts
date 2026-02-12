import type { GameState } from '../core/types';
import type { SessionMeta } from '../types';
import type { Controllers } from './controllerWiring';

/**
 * Fans out meta/state/labels to all controllers that track them.
 * Eliminates the 6+ repeated setMeta()/setCurrentState()/setLabels() blocks.
 */
export function propagateMeta(
  c: Controllers,
  meta: SessionMeta | null,
  state: GameState | null,
  labels: Record<string, string>
): void {
  c.gameController.setMeta(meta);
  c.networkController.setMeta(meta);
  if (state) c.networkController.setCurrentState(state);
  c.networkController.setLabels(labels);
  c.timerController.setMeta(meta);
  c.timerController.setConnection(c.networkController.getConnection());
  c.readyGate.setMeta(meta);
  if (state) c.readyGate.setCurrentState(state);
  c.readyGate.setLabels(labels);
  c.gameOverController.setMeta(meta);
  if (state) c.gameOverController.setCurrentState(state);
  c.gameOverController.setLabels(labels);
  c.endgameScanController.setMeta(meta);
  if (state) c.endgameScanController.setCurrentState(state);
}
