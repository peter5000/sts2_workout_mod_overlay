// Slay the Spire 2 Workout Mode Overlay - Modal & Summary State Machine

/**
 * Evaluates whether the run outcome summary modal (VICTORY or DEFEAT) should be displayed.
 *
 * Prevents the summary modal from repeatedly re-opening whenever a player logs reps,
 * adjusts their squat ratio, or receives real-time WebSocket state synchronizations.
 *
 * @param runStatus Current run status ('ACTIVE' | 'VICTORY' | 'DEFEAT')
 * @param runId Unique identifier of the current run session
 * @param dismissedRunId The run ID for which the summary was explicitly dismissed by the user
 * @param targetPanel The active window panel ('a', 'b', or 'all')
 * @returns boolean true if the summary modal should be rendered
 */
export function shouldShowSummaryModal(
  runStatus?: 'ACTIVE' | 'VICTORY' | 'DEFEAT',
  runId?: string,
  dismissedRunId?: string | null,
  targetPanel: string = 'all'
): boolean {
  // 1. Only terminal run outcomes (VICTORY or DEFEAT) produce a summary screen
  if (runStatus !== 'VICTORY' && runStatus !== 'DEFEAT') {
    return false;
  }

  // 2. Modals are only hosted on Panel A or unified 'all' windows (never on Panel B)
  const showPanelA = targetPanel === 'a' || targetPanel === 'all';
  if (!showPanelA) {
    return false;
  }

  // 3. If the user explicitly dismissed the summary for this active run session, suppress the modal
  if (runId && dismissedRunId === runId) {
    return false;
  }

  return true;
}
