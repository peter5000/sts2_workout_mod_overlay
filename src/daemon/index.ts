import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';

import { SaveWatcher } from './watcher';
import { DebtLedger } from './ledger';
import {
  ResolveRepsPayload,
  UpdateRatioPayload,
  StartSessionPayload,
  WebSocketMessage,
  RunDetectedEvent
} from '../shared/types';

dotenv.config();

const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = process.env.HOST || '127.0.0.1';
const defaultSaveDir = path.join(process.cwd(), 'test_saves');
const saveDir = process.env.STS2_SAVE_DIR || defaultSaveDir;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const ledger = new DebtLedger();

// Broadcast WebSocket message to all connected HUD overlay clients
function broadcast(message: WebSocketMessage): void {
  const payloadStr = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payloadStr);
    }
  });
}

// Save Watcher callback handler
const watcher = new SaveWatcher(saveDir, (saveData) => {
  const { isNewRun, commitData, terminatedEvent } = ledger.processSaveData(saveData);

  if (isNewRun) {
    const runDetectedMsg: RunDetectedEvent = {
      type: 'RUN_DETECTED',
      timestamp: Date.now(),
      data: {
        run_id: saveData.run_id,
        is_multiplayer: saveData.is_multiplayer,
        player_count: saveData.player_count,
        players: saveData.players,
        default_squat_ratio: ledger.getSquatRatio()
      }
    };
    console.log(`[DAEMON] Broadcasting RUN_DETECTED for run: ${saveData.run_id}`);
    broadcast(runDetectedMsg);
  }

  if (commitData) {
    console.log(`[DAEMON] Broadcasting WORKOUT_FLOOR_COMMITTED for floor ${commitData.floor}`);
    broadcast({
      type: 'WORKOUT_FLOOR_COMMITTED',
      timestamp: Date.now(),
      data: commitData
    });
  }

  if (terminatedEvent) {
    console.log(`[DAEMON] Broadcasting RUN_TERMINATED outcome: ${terminatedEvent.data.outcome}`);
    broadcast(terminatedEvent);
  }
});

// REST API Endpoints

// 1. GET /api/v1/session/state - Fetch full active session state
app.get('/api/v1/session/state', (req, res) => {
  res.json(ledger.getFullState());
});

// 2. POST /api/v1/session/start - Submits opt-in confirmation and starting ratio
app.post('/api/v1/session/start', (req, res) => {
  const payload = req.body as StartSessionPayload;
  if (typeof payload.opt_in === 'boolean') {
    ledger.setOptIn(payload.opt_in);
  }
  if (typeof payload.squat_ratio === 'number') {
    ledger.setSquatRatio(payload.squat_ratio);
  }
  res.json({ success: true, state: ledger.getFullState() });
});

// 3. POST /api/v1/workout/resolve - Submits custom rep logging or bulk clearance
app.post('/api/v1/workout/resolve', (req, res) => {
  const payload = req.body as ResolveRepsPayload;
  if (typeof payload.player_index !== 'number' || !payload.action_type) {
    res.status(400).json({ error: 'Missing required parameters: player_index, action_type' });
    return;
  }

  const result = ledger.resolveReps(payload);

  // Broadcast updated session state to all HUD overlays
  const currentState = ledger.getFullState();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'STATE_UPDATE', timestamp: Date.now(), data: currentState }));
    }
  });

  res.json(result);
});

// 4. POST /api/v1/config/ratio - Updates current squat ratio
app.post('/api/v1/config/ratio', (req, res) => {
  const payload = req.body as UpdateRatioPayload;
  if (typeof payload.squat_ratio === 'number' && payload.squat_ratio >= 1) {
    ledger.setSquatRatio(payload.squat_ratio);
    res.json({ success: true, squat_ratio: ledger.getSquatRatio() });
  } else {
    res.status(400).json({ error: 'Invalid squat_ratio parameter' });
  }
});

// WebSocket connection lifecycle
wss.on('connection', (ws) => {
  console.log('[WEBSOCKET] HUD Overlay client connected.');

  // Push immediate state snapshot upon connection
  ws.send(JSON.stringify({ type: 'STATE_SNAPSHOT', timestamp: Date.now(), data: ledger.getFullState() }));

  ws.on('close', () => {
    console.log('[WEBSOCKET] HUD Overlay client disconnected.');
  });
});

// Start Daemon Server
server.listen(PORT, HOST, () => {
  console.log(`\n=============================================================`);
  console.log(`🏋️  STS2 WORKOUT MODE DAEMON SERVER STARTED`);
  console.log(`=============================================================`);
  console.log(`   REST API      : http://${HOST}:${PORT}`);
  console.log(`   WebSocket     : ws://${HOST}:${PORT}`);
  console.log(`   Save Watcher  : ${saveDir}`);
  console.log(`=============================================================\n`);

  watcher.start();
});
