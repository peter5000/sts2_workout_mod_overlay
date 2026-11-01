import fs from 'fs';
import path from 'path';
import { SaveWatcher } from '../src/daemon/watcher';
import { RawRunSaveData } from '../src/shared/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ [ASSERTION FAILED] ${message}`);
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export async function runSaveWatcherTests(): Promise<void> {
  console.log('🧪 Running SaveWatcher Atomic Save & History Guard Tests...');

  const testDir = path.join(__dirname, 'scratch_watcher_unit_test');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });
  const historyDir = path.join(testDir, 'history');
  fs.mkdirSync(historyDir, { recursive: true });

  // 1. Setup an old stale history file (> 60 seconds old)
  const staleHistoryFile = path.join(historyDir, 'old_stale_defeat.run');
  fs.writeFileSync(
    staleHistoryFile,
    JSON.stringify({
      start_time: 1000000000,
      run_id: 'stale_abandoned_run',
      was_abandoned: true,
      players: [{ id: '10000000000000001', name: 'Hero' }],
      map_point_history: []
    })
  );
  const backdatedTime = (Date.now() - 60000) / 1000;
  fs.utimesSync(staleHistoryFile, backdatedTime, backdatedTime);

  // 2. Setup active multiplayer save
  const activeSavePath = path.join(testDir, 'current_run_mp.save');
  fs.writeFileSync(
    activeSavePath,
    JSON.stringify({
      start_time: 2000000000,
      run_id: 'active_combat_run',
      is_multiplayer: true,
      players: [{ id: '10000000000000001', name: 'HostPlayer' }],
      map_point_history: []
    })
  );

  const ingestedRuns: string[] = [];
  const watcher = new SaveWatcher(testDir, (data: RawRunSaveData) => {
    ingestedRuns.push(data.run_id);
  });

  watcher.start();
  // Wait for initial active save detection
  await new Promise((r) => setTimeout(r, 120));
  assert(ingestedRuns.includes('active_combat_run'), 'Initial active save must be ingested');

  // =========================================================================
  // Test A: Atomic Save / Rewrite (Unlink followed immediately by rewrite)
  // =========================================================================
  // Game temporarily unlinks current_run_mp.save to replace it with updated floor
  fs.unlinkSync(activeSavePath);
  fs.writeFileSync(
    activeSavePath,
    JSON.stringify({
      start_time: 2000000000,
      run_id: 'active_combat_run',
      current_floor: 2,
      is_multiplayer: true,
      players: [{ id: '10000000000000001', name: 'HostPlayer' }],
      map_point_history: []
    })
  );

  // Wait 400ms for unlink check (300ms delay) to ensure it skips history fallback
  await new Promise((r) => setTimeout(r, 400));

  assert(
    !ingestedRuns.includes('stale_abandoned_run'),
    'Atomic save rewrite must NOT trigger fallback to stale historical runs'
  );
  console.log('  ✓ Atomic save rewrite preservation (no stale history fallback) verified');

  // =========================================================================
  // Test B: Active save deleted, stale history rejected
  // =========================================================================
  // Game terminates or crashes without writing fresh history
  fs.unlinkSync(activeSavePath);
  await new Promise((r) => setTimeout(r, 400));

  assert(
    !ingestedRuns.includes('stale_abandoned_run'),
    'Watcher must reject stale historical runs with mtime > 15s when active save is deleted'
  );
  console.log('  ✓ Stale history file rejection on active save deletion verified');

  // =========================================================================
  // Test C: Genuine run completion with fresh history file
  // =========================================================================
  // Game writes targeted history file matching activeStartTime
  const targetedFreshFile = path.join(historyDir, '2000000000.run');
  fs.writeFileSync(
    targetedFreshFile,
    JSON.stringify({
      start_time: 2000000000,
      run_id: 'active_combat_run',
      was_abandoned: true,
      players: [{ id: '10000000000000001', name: 'HostPlayer' }],
      map_point_history: []
    })
  );

  await new Promise((r) => setTimeout(r, 300));
  assert(
    ingestedRuns.filter((id) => id === 'active_combat_run').length >= 2,
    'Targeted completed run history file must be ingested upon run termination'
  );
  console.log('  ✓ Genuine completed run history file ingestion verified');

  // Teardown
  watcher.stop();
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });

  console.log('  ✓ All SaveWatcher unit tests passed cleanly!\n');
}

