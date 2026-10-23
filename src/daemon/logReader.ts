import fs from 'fs';
import path from 'path';

export interface CombatDeathInfo {
  success: boolean;
  logFound: boolean;
  diedPlayers: Set<string>;
  deathTurns: Record<string, number>;
  playerLastTurns: Record<string, number>;
  maxCombatTurn: number;
}

export function getDefaultGodotLogPath(): string {
  if (process.env.STS2_LOG_PATH && process.env.STS2_LOG_PATH.trim().length > 0) {
    return process.env.STS2_LOG_PATH.trim();
  }
  const appData = process.env.APPDATA || (process.platform === 'win32' ? path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming') : '');
  return path.join(appData, 'SlayTheSpire2', 'logs', 'godot.log');
}

export function parseCombatSlice(sliceText: string): CombatDeathInfo {
  const lines = sliceText.split(/\r?\n/);

  const diedPlayers = new Set<string>();
  const deathTurns: Record<string, number> = {};
  const playerLastTurns: Record<string, number> = {};
  let maxCombatTurn = 0;

  for (const line of lines) {
    const turnMatch = line.match(/EndPlayerTurnAction for player (\d+) turn (\d+)/) ||
                      line.match(/NetEndPlayerTurnAction turn:\s*(\d+).*?from (\d+)/);

    if (turnMatch) {
      let pid = '';
      let turnNum = 0;
      if (line.includes('NetEndPlayerTurnAction')) {
        turnNum = parseInt(turnMatch[1], 10);
        pid = turnMatch[2];
      } else {
        pid = turnMatch[1];
        turnNum = parseInt(turnMatch[2], 10);
      }

      if (pid && !isNaN(turnNum)) {
        playerLastTurns[pid] = turnNum;
        if (turnNum > maxCombatTurn) {
          maxCombatTurn = turnNum;
        }
      }
    }

    const deathMatch = line.match(/Player (\d+) died, doing death handling/);
    if (deathMatch) {
      const deadPid = deathMatch[1];
      diedPlayers.add(deadPid);
      const frozenTurn = playerLastTurns[deadPid] || maxCombatTurn || 1;
      deathTurns[deadPid] = frozenTurn;
    }
  }

  return {
    success: true,
    logFound: true,
    diedPlayers,
    deathTurns,
    playerLastTurns,
    maxCombatTurn
  };
}

export function getCombatDeathInfoFromLog(logPath?: string): CombatDeathInfo {
  const targetPath = logPath || getDefaultGodotLogPath();

  const notFoundResult: CombatDeathInfo = {
    success: false,
    logFound: false,
    diedPlayers: new Set<string>(),
    deathTurns: {},
    playerLastTurns: {},
    maxCombatTurn: 0
  };

  if (!fs.existsSync(targetPath)) {
    return notFoundResult;
  }

  const parseFailedResult: CombatDeathInfo = {
    success: false,
    logFound: true,
    diedPlayers: new Set<string>(),
    deathTurns: {},
    playerLastTurns: {},
    maxCombatTurn: 0
  };

  try {
    let fd: number | null = null;
    try {
      fd = fs.openSync(targetPath, 'r');
    } catch {
      return parseFailedResult;
    }

    const stats = fs.fstatSync(fd);
    const fileSize = stats.size;
    if (fileSize === 0) {
      fs.closeSync(fd);
      return parseFailedResult;
    }

    const chunkSteps = [256 * 1024, 512 * 1024, 1024 * 1024, 2048 * 1024];
    let combatSliceText: string | null = null;

    for (const chunkSize of chunkSteps) {
      const readSize = Math.min(fileSize, chunkSize);
      const startPos = Math.max(0, fileSize - readSize);
      const buffer = Buffer.alloc(readSize);

      fs.readSync(fd, buffer, 0, readSize, startPos);
      const text = buffer.toString('utf-8');

      const combatHeaderIdx = text.lastIndexOf('Creating NCombatRoom with mode=ActiveCombat');
      if (combatHeaderIdx !== -1) {
        combatSliceText = text.slice(combatHeaderIdx);
        break;
      }

      if (readSize >= fileSize) {
        combatSliceText = text;
        break;
      }
    }

    fs.closeSync(fd);

    if (!combatSliceText) {
      return parseFailedResult;
    }

    return parseCombatSlice(combatSliceText);
  } catch (err) {
    console.error('[LOG READER ERROR] Failed to parse combat death info from log:', err);
    return parseFailedResult;
  }
}