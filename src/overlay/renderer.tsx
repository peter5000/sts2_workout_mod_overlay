import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ipcRenderer } from 'electron';
import {
  ActiveSessionStore,
  WebSocketMessage
} from '../shared/types';

const API_BASE = 'http://127.0.0.1:8765';
const WS_URL = 'ws://127.0.0.1:8765';

const App: React.FC = () => {
  const [session, setSession] = useState<ActiveSessionStore | null>(null);
  const selectedPlayerIdx = 0; // Strictly local player stats
  const [repsInput, setRepsInput] = useState<string>('10');
  const [clickThrough, setClickThrough] = useState<boolean>(false);
  const [showStartModal, setShowStartModal] = useState<boolean>(false);
  const [startRatio, setStartRatio] = useState<number>(2);
  const [countdownText, setCountdownText] = useState<string>('24:00:00');

  // Collapsible Squat Ratio section state
  const [ratioCollapsed, setRatioCollapsed] = useState<boolean>(false);

  // Detect which panel window this instance represents ('a', 'b', or 'all')
  const urlParams = new URLSearchParams(window.location.search);
  const targetPanel = urlParams.get('panel') || 'all';

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
          } else if (
            msg.type === 'WORKOUT_FLOOR_COMMITTED' ||
            msg.type === 'STATE_UPDATE' ||
            msg.type === 'STATE_SNAPSHOT' ||
            msg.type === 'RUN_TERMINATED'
          ) {
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

  // Local player active stats
  const activeDebt = session?.player_debts?.[selectedPlayerIdx] || 0;
  const activeAggs = session?.player_aggregates?.[selectedPlayerIdx] || { accrued: 0, pushups: 0, squats: 0 };
  const ratio = session?.squat_ratio || 2;

  const showPanelA = targetPanel === 'a' || targetPanel === 'all';
  const showPanelB = targetPanel === 'b' || targetPanel === 'all';

  return (
    <div style={styles.container}>
      {/* Header Bar with Click Through (Ctrl+Shift+X) actual command text */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          {targetPanel === 'a' && '🏋️ Panel A: Debt Resolver'}
          {targetPanel === 'b' && '📊 Panel B: Run Ledger'}
          {targetPanel === 'all' && '🏋️ StS2 Workout HUD'}
        </div>
        <button
          onClick={() => ipcRenderer.send('set-click-through', !clickThrough)}
          style={{
            ...styles.badge,
            backgroundColor: clickThrough ? 'rgba(229, 62, 62, 0.85)' : 'rgba(49, 151, 149, 0.85)'
          }}
        >
          {clickThrough ? 'Click through ON (Ctrl+Shift+X)' : 'Click through OFF (Ctrl+Shift+X)'}
        </button>
      </div>

      {/* PANEL A: Remainder Resolver Window */}
      {showPanelA && (
        <div style={styles.panel}>
          <div style={styles.counterBox}>
            <div style={styles.counterLabel}>REMAINING WORKOUT COUNT (YOURS)</div>
            <div style={{ ...styles.counterValue, color: activeDebt > 0 ? '#fc8181' : '#68d391' }}>
              {activeDebt} <span style={styles.unitText}>wc</span>
            </div>
          </div>

          <div style={styles.actionRow}>
            <input
              type="number"
              min="1"
              value={repsInput}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRepsInput(e.target.value)}
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

          <div style={styles.actionRow}>
            <button onClick={() => handleResolveReps('ALL_PUSHUPS')} style={styles.btnClear}>
              All Push-ups ({activeDebt})
            </button>
            <button onClick={() => handleResolveReps('ALL_SQUATS')} style={styles.btnClear}>
              All Squats ({activeDebt * ratio})
            </button>
          </div>
        </div>
      )}

      {/* PANEL B: Aggregate Ledger Window */}
      {showPanelB && (
        <div style={styles.panel}>
          <div style={styles.statGrid}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Push-ups</div>
              <div style={styles.statVal}>{activeAggs.pushups}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Squats</div>
              <div style={styles.statVal}>{activeAggs.squats}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Remaining workout count</div>
              <div style={{ ...styles.statVal, color: activeDebt > 0 ? '#fc8181' : '#68d391' }}>{activeDebt} wc</div>
            </div>
          </div>

          {/* Collapsible Squat Ratio with small arrow */}
          <div style={styles.ratioRow}>
            <button
              onClick={() => setRatioCollapsed(!ratioCollapsed)}
              style={styles.ratioToggleBtn}
            >
              {ratioCollapsed ? `▶ Squat Ratio (R = ${ratio})` : '▼ Squat Ratio'}
            </button>
            {!ratioCollapsed && (
              <div style={{ display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
                <button onClick={() => handleUpdateRatio(ratio - 1)} style={styles.stepperBtn}>-</button>
                <span style={{ fontWeight: 'bold', padding: '0 6px' }}>R = {ratio}</span>
                <button onClick={() => handleUpdateRatio(ratio + 1)} style={styles.stepperBtn}>+</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: Run Start Prompt */}
      {showStartModal && showPanelA && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <h3 style={{ color: '#63b3ed', fontSize: 'clamp(14px, 3vh, 18px)' }}>🚀 RUN START INITIALIZED</h3>
            <p style={{ margin: '8px 0', fontSize: 'clamp(11px, 2vh, 13px)', color: '#cbd5e0' }}>
              Enable Workout Mode for this session?
            </p>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: 'clamp(11px, 2vh, 13px)', marginRight: '6px' }}>Starting Squat Ratio (R):</label>
              <input
                type="number"
                min="1"
                value={startRatio}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartRatio(parseInt(e.target.value, 10) || 1)}
                style={{ ...styles.input, width: '50px' }}
              />
            </div>
            <button onClick={handleConfirmStart} style={styles.btnSuccess}>
              Confirm & Arm Engine
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: Run Outcome Screen (Shows All Players Stats) */}
      {session?.run_status !== 'ACTIVE' && showPanelA && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            {session?.run_status === 'VICTORY' ? (
              <>
                <h2 style={{ color: '#68d391', fontSize: 'clamp(16px, 3.5vh, 22px)' }}>🏆 VICTORY ACHIEVED!</h2>
                <p style={{ margin: '6px 0', fontSize: 'clamp(10px, 2vh, 12px)', color: '#cbd5e0' }}>
                  All floors cleared! Final party workout summary:
                </p>
              </>
            ) : (
              <>
                <h2 style={{ color: '#fc8181', fontSize: 'clamp(16px, 3.5vh, 22px)' }}>💀 RUN DEFEATED</h2>
                <p style={{ color: '#feb2b2', fontWeight: 'bold', margin: '4px 0', fontSize: 'clamp(11px, 2vh, 13px)' }}>
                  Mandatory 30-Minute Jog Penalty Triggered!
                </p>
                <div style={styles.timerBox}>
                  <div style={{ fontSize: 'clamp(9px, 1.8vh, 11px)', color: '#cbd5e0' }}>TIME REMAINING TO COMPLETE JOG</div>
                  <div style={{ fontSize: 'clamp(20px, 5vh, 32px)', fontWeight: 'bold', color: '#f6ad55' }}>
                    {countdownText}
                  </div>
                </div>
              </>
            )}

            {/* PARTY SUMMARY TABLE FOR ALL PLAYERS */}
            <div style={{ margin: '10px 0', textAlign: 'left', overflowX: 'auto' }}>
              <div style={{ fontSize: 'clamp(10px, 2vh, 12px)', fontWeight: 'bold', color: '#a0aec0', marginBottom: '4px' }}>
                PARTY SUMMARY (ALL PLAYERS)
              </div>
              <table style={styles.summaryTable}>
                <thead>
                  <tr>
                    <th style={styles.th}>Player</th>
                    <th style={styles.th}>Debt</th>
                    <th style={styles.th}>Push-ups</th>
                    <th style={styles.th}>Squats</th>
                    <th style={styles.th}>Deaths</th>
                  </tr>
                </thead>
                <tbody>
                  {session?.player_debts &&
                    Object.keys(session.player_debts).map((pIdxStr) => {
                      const pIdx = parseInt(pIdxStr, 10);
                      const debt = session.player_debts[pIdx] || 0;
                      const aggs = session.player_aggregates?.[pIdx] || { pushups: 0, squats: 0 };
                      const deaths = session.player_deaths?.[pIdx] || 0;
                      return (
                        <tr key={pIdx}>
                          <td style={styles.td}>Player {pIdx + 1}</td>
                          <td style={{ ...styles.td, color: debt > 0 ? '#fc8181' : '#68d391', fontWeight: 'bold' }}>
                            {debt} wc
                          </td>
                          <td style={styles.td}>{aggs.pushups}</td>
                          <td style={styles.td}>{aggs.squats}</td>
                          <td style={styles.td}>{deaths}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <button onClick={() => setSession({ ...session!, run_status: 'ACTIVE' })} style={styles.btnPrimary}>
              Dismiss Summary
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 'clamp(4px, 1.5vh, 10px)',
    height: '100vh',
    width: '100vw',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 'clamp(4px, 1vh, 8px)',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 'clamp(2px, 0.8vh, 6px)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
    WebkitAppRegion: 'drag',
    flexShrink: 0
  } as React.CSSProperties,
  headerTitle: {
    fontWeight: 'bold',
    fontSize: 'clamp(10px, 2.2vh, 13px)',
    color: '#edf2f7',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  badge: {
    padding: 'clamp(2px, 0.5vh, 4px) clamp(4px, 1vw, 8px)',
    borderRadius: '4px',
    color: '#fff',
    fontSize: 'clamp(8px, 1.6vh, 10px)',
    fontWeight: 'bold',
    border: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties,
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    background: 'rgba(15, 22, 34, 0.45)',
    backdropFilter: 'blur(8px)',
    padding: 'clamp(6px, 1.5vh, 12px)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    overflow: 'hidden'
  },
  counterBox: {
    flex: 2,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.25)',
    borderRadius: '6px',
    marginBottom: 'clamp(4px, 1vh, 8px)',
    padding: 'clamp(4px, 1vh, 8px)'
  },
  counterLabel: {
    fontSize: 'clamp(9px, 1.8vh, 11px)',
    color: '#a0aec0',
    fontWeight: 'bold'
  },
  counterValue: {
    fontSize: 'clamp(20px, 7vh, 42px)',
    fontWeight: 'bold',
    lineHeight: 1.1
  },
  unitText: {
    fontSize: 'clamp(12px, 3vh, 18px)'
  },
  actionRow: {
    flex: 1,
    display: 'flex',
    gap: 'clamp(4px, 1vw, 8px)',
    marginBottom: 'clamp(2px, 0.5vh, 6px)',
    minHeight: '26px'
  },
  input: {
    width: 'clamp(50px, 18%, 80px)',
    padding: 'clamp(2px, 0.8vh, 6px)',
    borderRadius: '4px',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#fff',
    fontSize: 'clamp(10px, 2.2vh, 13px)'
  },
  btnPrimary: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(4px, 1vh, 8px)',
    borderRadius: '4px',
    border: 'none',
    background: 'rgba(49, 130, 206, 0.85)',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 'clamp(9px, 2.2vh, 12px)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  btnClear: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(4px, 1vh, 8px)',
    borderRadius: '4px',
    border: 'none',
    background: 'rgba(128, 90, 213, 0.85)',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 'clamp(9px, 2.2vh, 12px)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  btnSuccess: {
    width: '100%',
    padding: 'clamp(6px, 1.5vh, 10px)',
    borderRadius: '6px',
    border: 'none',
    background: 'rgba(56, 161, 105, 0.9)',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 'clamp(11px, 2.2vh, 14px)'
  },
  statGrid: {
    flex: 2,
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 'clamp(4px, 1vw, 8px)',
    marginBottom: 'clamp(4px, 1vh, 8px)'
  },
  statCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.25)',
    padding: 'clamp(4px, 1vh, 8px)',
    borderRadius: '4px'
  },
  statLabel: {
    fontSize: 'clamp(8px, 1.8vh, 10px)',
    color: '#a0aec0',
    textAlign: 'center'
  },
  statVal: {
    fontSize: 'clamp(12px, 3.2vh, 20px)',
    fontWeight: 'bold',
    color: '#edf2f7'
  },
  ratioRow: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 'clamp(10px, 2.2vh, 14px)'
  },
  ratioToggleBtn: {
    background: 'transparent',
    border: 'none',
    color: '#cbd5e0',
    fontSize: 'clamp(10px, 2.2vh, 13px)',
    fontWeight: 'bold',
    cursor: 'pointer',
    padding: 0
  },
  stepperBtn: {
    width: 'clamp(18px, 4vh, 24px)',
    height: 'clamp(18px, 4vh, 24px)',
    borderRadius: '4px',
    border: 'none',
    background: 'rgba(255, 255, 255, 0.15)',
    color: '#fff',
    fontWeight: 'bold',
    cursor: 'pointer',
    fontSize: 'clamp(10px, 2vh, 14px)'
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(10, 14, 23, 0.88)',
    backdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'clamp(8px, 2vh, 16px)',
    borderRadius: '12px'
  },
  modalCard: {
    background: 'rgba(26, 32, 44, 0.95)',
    padding: 'clamp(10px, 2vh, 16px)',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    textAlign: 'center',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  timerBox: {
    background: 'rgba(0, 0, 0, 0.3)',
    padding: 'clamp(6px, 1.5vh, 10px)',
    borderRadius: '6px',
    margin: '8px 0'
  },
  summaryTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 'clamp(9px, 1.8vh, 11px)',
    background: 'rgba(0, 0, 0, 0.2)',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  th: {
    padding: 'clamp(3px, 0.8vh, 6px)',
    background: 'rgba(255, 255, 255, 0.1)',
    color: '#cbd5e0',
    textAlign: 'left'
  } as React.CSSProperties,
  td: {
    padding: 'clamp(3px, 0.8vh, 6px)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
    textAlign: 'left'
  } as React.CSSProperties
};

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<App />);
}
