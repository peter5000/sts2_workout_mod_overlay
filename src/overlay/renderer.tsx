import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ipcRenderer } from 'electron';
import {
  ActiveSessionStore,
  WebSocketMessage,
  PartyMemberSummary,
  PlayerInfo
} from '../shared/types';

const API_BASE = 'http://127.0.0.1:8765';
const WS_URL = 'ws://127.0.0.1:8765';

const App: React.FC = () => {
  const [session, setSession] = useState<ActiveSessionStore | null>(null);
  const [selectedPlayerIdx, setSelectedPlayerIdx] = useState<number>(0);
  const [repsInput, setRepsInput] = useState<string>('10');
  const [clickThrough, setClickThrough] = useState<boolean>(false);
  const [showStartModal, setShowStartModal] = useState<boolean>(false);
  const [startRatio, setStartRatio] = useState<number>(2);
  const [countdownText, setCountdownText] = useState<string>('24:00:00');

  // Fetch initial state snapshot from REST API
  const fetchState = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/session/state`);
      if (res.ok) {
        const data: ActiveSessionStore = await res.json();
        setSession(data);
        if (data.squat_ratio) {
          setStartRatio(data.squat_ratio);
        }
      }
    } catch (e) {
      console.warn('Daemon server offline or starting up...');
    }
  };

  useEffect(() => {
    fetchState();

    // Setup WebSocket listener for real-time events
    let ws: WebSocket | null = null;
    const connectWS = () => {
      ws = new WebSocket(WS_URL);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'RUN_DETECTED') {
            setShowStartModal(true);
            fetchState();
          } else if (msg.type === 'WORKOUT_FLOOR_COMMITTED' || msg.type === 'STATE_UPDATE' || msg.type === 'STATE_SNAPSHOT' || msg.type === 'RUN_TERMINATED') {
            fetchState();
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };
      ws.onclose = () => {
        setTimeout(connectWS, 2000);
      };
    };

    connectWS();

    // Listen to IPC click-through state changes
    ipcRenderer.on('click-through-changed', (event, state: boolean) => {
      setClickThrough(state);
    });

    return () => {
      if (ws) ws.close();
    };
  }, []);

  // Live countdown timer ticker for 24h Jog Penalty
  useEffect(() => {
    if (!session?.jog_penalty?.active || !session.jog_penalty.deadline_timestamp) return;

    const interval = setInterval(() => {
      const remaining = Math.max(session.jog_penalty.deadline_timestamp! - Date.now(), 0);
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((remaining % (1000 * 60)) / 1000);
      setCountdownText(
        `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [session?.jog_penalty]);

  // REST Action Handlers
  const handleResolveReps = async (actionType: 'CUSTOM_ENTRY' | 'ALL_PUSHUPS' | 'ALL_SQUATS', exercise?: 'pushups' | 'squats') => {
    const val = parseInt(repsInput, 10) || 0;
    try {
      await fetch(`${API_BASE}/api/v1/workout/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_index: selectedPlayerIdx,
          action_type: actionType,
          exercise,
          reps: val,
          applied_ratio: session?.squat_ratio || 2
        })
      });
      fetchState();
    } catch (e) {
      console.error('Failed to resolve reps:', e);
    }
  };

  const handleUpdateRatio = async (newRatio: number) => {
    if (newRatio < 1) return;
    try {
      await fetch(`${API_BASE}/api/v1/config/ratio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ squat_ratio: newRatio })
      });
      fetchState();
    } catch (e) {
      console.error('Failed to update squat ratio:', e);
    }
  };

  const handleConfirmStart = async () => {
    try {
      await fetch(`${API_BASE}/api/v1/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opt_in: true, squat_ratio: startRatio })
      });
      setShowStartModal(false);
      fetchState();
    } catch (e) {
      console.error('Failed to confirm session start:', e);
    }
  };

  const activeDebt = session?.player_debts?.[selectedPlayerIdx] || 0;
  const activeAggs = session?.player_aggregates?.[selectedPlayerIdx] || { accrued: 0, pushups: 0, squats: 0 };
  const ratio = session?.squat_ratio || 2;

  return (
    <div style={styles.container}>
      {/* Title Bar & Click-Through Control */}
      <div style={styles.header}>
        <div style={{ fontWeight: 'bold', fontSize: '14px', letterSpacing: '0.5px' }}>
          🏋️ StS2 Workout HUD
        </div>
        <button
          onClick={() => ipcRenderer.send('set-click-through', !clickThrough)}
          style={{
            ...styles.badge,
            backgroundColor: clickThrough ? '#e53e3e' : '#319795'
          }}
        >
          {clickThrough ? 'Click-Through: ON (Ctrl+Shift+X)' : 'Click-Through: OFF'}
        </button>
      </div>

      {/* Multiplayer Player Selector */}
      {session?.is_multiplayer && (
        <div style={styles.tabBar}>
          {Object.keys(session.player_debts).map((pIdx) => {
            const idx = parseInt(pIdx, 10);
            return (
              <button
                key={idx}
                onClick={() => setSelectedPlayerIdx(idx)}
                style={{
                  ...styles.tabButton,
                  backgroundColor: selectedPlayerIdx === idx ? '#4a5568' : '#2d3748'
                }}
              >
                Player {idx + 1} ({session.player_debts[idx] || 0} wc)
              </button>
            );
          })}
        </div>
      )}

      {/* PANEL A: Remainder Resolver */}
      <div style={styles.panel}>
        <div style={styles.panelTitle}>PANEL A: REMAINDER RESOLVER</div>
        <div style={styles.counterBox}>
          <div style={{ fontSize: '12px', color: '#a0aec0' }}>UNRESOLVED DEBT</div>
          <div style={{ fontSize: '36px', fontWeight: 'bold', color: activeDebt > 0 ? '#fc8181' : '#68d391' }}>
            {activeDebt} <span style={{ fontSize: '18px' }}>wc</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <input
            type="number"
            min="1"
            value={repsInput}
            onChange={(e) => setRepsInput(e.target.value)}
            style={styles.input}
            placeholder="Reps"
          />
          <button onClick={() => handleResolveReps('CUSTOM_ENTRY', 'pushups')} style={styles.btnPrimary}>
            Log Push-ups
          </button>
          <button onClick={() => handleResolveReps('CUSTOM_ENTRY', 'squats')} style={styles.btnPrimary}>
            Log Squats
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => handleResolveReps('ALL_PUSHUPS')} style={styles.btnClear}>
            All Push-ups ({activeDebt} reps)
          </button>
          <button onClick={() => handleResolveReps('ALL_SQUATS')} style={styles.btnClear}>
            All Squats ({activeDebt * ratio} reps)
          </button>
        </div>
      </div>

      {/* PANEL B: Aggregate Ledger */}
      <div style={styles.panel}>
        <div style={styles.panelTitle}>PANEL B: AGGREGATE LEDGER</div>
        <div style={styles.statGrid}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Completed Push-ups</div>
            <div style={styles.statVal}>{activeAggs.pushups}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Completed Squats</div>
            <div style={styles.statVal}>{activeAggs.squats}</div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>Total Accrued (wc)</div>
            <div style={styles.statVal}>{activeAggs.accrued}</div>
          </div>
        </div>

        <div style={styles.ratioRow}>
          <span>Squat Ratio (R): </span>
          <button onClick={() => handleUpdateRatio(ratio - 1)} style={styles.stepperBtn}>-</button>
          <span style={{ fontWeight: 'bold', padding: '0 8px' }}>R = {ratio}</span>
          <button onClick={() => handleUpdateRatio(ratio + 1)} style={styles.stepperBtn}>+</button>
        </div>
      </div>

      {/* MODAL 1: Run Start Prompt */}
      {showStartModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3>🚀 RUN START INITIALIZED</h3>
            <p style={{ margin: '12px 0', fontSize: '13px', color: '#cbd5e0' }}>
              Enable Workout Mode for this session?
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ fontSize: '13px', marginRight: '8px' }}>Starting Squat Ratio (R):</label>
              <input
                type="number"
                min="1"
                value={startRatio}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartRatio(parseInt(e.target.value, 10) || 1)}
                style={{ ...styles.input, width: '60px' }}
              />
            </div>
            <button onClick={handleConfirmStart} style={styles.btnSuccess}>
              Confirm & Arm Workout Engine
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: Run Outcome Screen */}
      {session?.run_status !== 'ACTIVE' && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            {session?.run_status === 'VICTORY' ? (
              <>
                <h2 style={{ color: '#68d391' }}>🏆 VICTORY ACHIEVED!</h2>
                <p style={{ margin: '12px 0' }}>All floors cleared. Outstanding workout stats recorded!</p>
              </>
            ) : (
              <>
                <h2 style={{ color: '#fc8181' }}>💀 RUN DEFEATED</h2>
                <p style={{ color: '#feb2b2', fontWeight: 'bold', margin: '8px 0' }}>
                  Mandatory 30-Minute Jog Penalty Triggered!
                </p>
                <div style={styles.timerBox}>
                  <div style={{ fontSize: '12px', color: '#cbd5e0' }}>TIME REMAINING TO COMPLETE JOG</div>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#f6ad55' }}>
                    {countdownText}
                  </div>
                </div>
              </>
            )}
            <button onClick={() => setSession({ ...session!, run_status: 'ACTIVE' })} style={styles.btnPrimary}>
              Dismiss Banner
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '12px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '8px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    WebkitAppRegion: 'drag'
  } as React.CSSProperties,
  badge: {
    padding: '4px 8px',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '11px',
    fontWeight: 'bold',
    border: 'none',
    cursor: 'pointer',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties,
  tabBar: {
    display: 'flex',
    gap: '6px'
  },
  tabButton: {
    flex: 1,
    padding: '6px',
    border: 'none',
    borderRadius: '4px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '12px'
  },
  panel: {
    background: 'rgba(26, 32, 44, 0.75)',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)'
  },
  panelTitle: {
    fontSize: '11px',
    fontWeight: 'bold',
    color: '#a0aec0',
    marginBottom: '8px',
    letterSpacing: '0.5px'
  },
  counterBox: {
    textAlign: 'center',
    padding: '12px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    marginBottom: '12px'
  },
  input: {
    width: '70px',
    padding: '6px 8px',
    borderRadius: '4px',
    border: '1px solid #4a5568',
    background: '#2d3748',
    color: '#fff',
    fontSize: '13px'
  },
  btnPrimary: {
    flex: 1,
    padding: '6px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#3182ce',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '12px'
  },
  btnClear: {
    flex: 1,
    padding: '6px 12px',
    borderRadius: '4px',
    border: 'none',
    background: '#805ad5',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '12px'
  },
  btnSuccess: {
    width: '100%',
    padding: '10px',
    borderRadius: '6px',
    border: 'none',
    background: '#38a169',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: '14px'
  },
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '6px',
    marginBottom: '10px'
  },
  statCard: {
    background: 'rgba(0, 0, 0, 0.25)',
    padding: '8px',
    borderRadius: '4px',
    textAlign: 'center'
  },
  statLabel: {
    fontSize: '10px',
    color: '#a0aec0'
  },
  statVal: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#edf2f7'
  },
  ratioRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    marginTop: '6px'
  },
  stepperBtn: {
    width: '24px',
    height: '24px',
    borderRadius: '4px',
    border: 'none',
    background: '#4a5568',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer'
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    borderRadius: '12px'
  },
  modalCard: {
    background: '#1a202c',
    padding: '20px',
    borderRadius: '10px',
    border: '1px solid #4a5568',
    textAlign: 'center',
    width: '100%'
  },
  timerBox: {
    background: '#2d3748',
    padding: '12px',
    borderRadius: '6px',
    margin: '12px 0'
  }
};

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}
