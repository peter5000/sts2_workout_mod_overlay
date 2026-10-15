import { parseCombatSlice } from '../src/daemon/logReader';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export function runLogReaderTests() {
  console.log('🧪 Running Log Reader Unit Tests...');

  // Test 1: Phantasmal Gardeners Elite fight slice
  const rawSlice1 = `
[INFO] Creating NCombatRoom with mode=ActiveCombat encounter=PHANTASMAL_GARDENERS_ELITE.
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000001 turn 1
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000002 turn 1
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000001 turn 6
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000002 turn 6
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000001 turn 7
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000002 turn 7
[DEBUG] Combat state becomes NotPlayPhase. Pausing all player queues
[INFO] Monster PHANTASMAL_GARDENER performing move BITE_MOVE
[INFO] Player 10000000000000001 died, doing death handling
[INFO] Setting player 10000000000000001 to ready at start of turn. IsDead: True. IsStartingTurn: True
[DEBUG] Combat state becomes PlayPhase.
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000002 turn 8
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 10000000000000002 turn 11
[INFO] CHARACTER.NECROBINDER has won against encounter ENCOUNTER.PHANTASMAL_GARDENERS_ELITE. That's 20 wins
  `;

  const info1 = parseCombatSlice(rawSlice1);
  assert(info1.diedPlayers.has('10000000000000001'), 'Player 1 must be in diedPlayers');
  assert(!info1.diedPlayers.has('10000000000000002'), 'Player 2 must not be in diedPlayers');
  assert(info1.deathTurns['10000000000000001'] === 7, 'Player 1 death turn must be 7');
  assert(info1.playerLastTurns['10000000000000002'] === 11, 'Player 2 last turn must be 11');
  assert(info1.maxCombatTurn === 11, 'Max combat turn must be 11');

  // Test 2: NetEndPlayerTurnAction syntax
  const rawSlice2 = `
[INFO] Creating NCombatRoom with mode=ActiveCombat encounter=SEAPUNK_WEAK.
[VERYDEBUG] [RunLocationTargetedMessageBuffer] Handling map-targeted message RequestEnqueueActionMessage location: act 0 coord (2, 1) room 0 action: NetEndPlayerTurnAction turn: 4 from 10000000000000002 for location act 0 coord (2, 1) room 0
[INFO] Player 10000000000000002 died, doing death handling
  `;

  const info2 = parseCombatSlice(rawSlice2);
  assert(info2.diedPlayers.has('10000000000000002'), 'Player 2 must be in diedPlayers');
  assert(info2.deathTurns['10000000000000002'] === 4, 'Player 2 death turn must be 4');
  assert(info2.maxCombatTurn === 4, 'Max combat turn must be 4');

  // Test 3: No deaths
  const rawSlice3 = `
[INFO] Creating NCombatRoom with mode=ActiveCombat encounter=SLUDGE_SPINNER_WEAK.
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 1111 turn 1
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 2222 turn 1
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 1111 turn 2
[DEBUG] [ActionExecutor] Executing action: EndPlayerTurnAction for player 2222 turn 2
[INFO] CHARACTER.IRONCLAD has won against encounter ENCOUNTER.SLUDGE_SPINNER_WEAK.
  `;

  const info3 = parseCombatSlice(rawSlice3);
  assert(info3.diedPlayers.size === 0, 'No players should be dead');
  assert(info3.maxCombatTurn === 2, 'Max combat turn must be 2');
  assert(info3.playerLastTurns['1111'] === 2, 'Player 1111 turn must be 2');
  assert(info3.playerLastTurns['2222'] === 2, 'Player 2222 turn must be 2');

  console.log('  ✓ Log Reader unit tests passed cleanly!');
}

if (require.main === module) {
  runLogReaderTests();
}