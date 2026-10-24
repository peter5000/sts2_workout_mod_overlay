// Slay the Spire 2 Workout Mode Overlay - Shared Types & Data Contracts

export const APP_VERSION = '1.5.0';

export interface PlayerInfo {
  index: number;
  name: string;
  character: string;
}

export interface ActiveSessionStore {
  run_id: string;
  is_multiplayer: boolean;
  player_count: number;
  squat_ratio: number;
  player_squat_ratios?: Record<number, number>;
  opt_in: boolean;
  last_processed_floor: number;
  player_debts: Record<number, number>;
  player_deaths: Record<number, number>;
  player_aggregates: Record<number, { accrued: number; pushups: number; squats: number }>;
  player_squat_remainders?: Record<number, number>;
  player_names?: Record<number, string>;
  run_status: 'ACTIVE' | 'VICTORY' | 'DEFEAT';
  jog_penalty: {
    active: boolean;
    deadline_timestamp: number | null;
  };
  pending_floor?: {
    floor_num: number;
    room_type: RoomType;
  } | null;
  pending_player_floors?: Record<number, PendingPlayerFloor>;
}

export interface PendingPlayerFloor {
  player_index: number;
  floor_num: number;
  room_type: RoomType;
  wc: number;
  formula: string;
  turns_taken: number;
  deaths_accumulated: number;
  hp_lost: number;
  player_died: boolean;
  committed: boolean;
}

export type RoomType = 'monster' | 'elite' | 'boss' | 'event' | 'campfire' | 'shop' | 'rest';

// Raw Save File Data Contracts (Ingested from StS2 Save File)
export interface RawPlayerFloorMetric {
  player_index: number;
  player_name: string;
  hp_start: number;
  hp_end: number;
  died_this_floor: boolean;
  death_turn: number | null;
}

export interface RawFloorEntry {
  floor_num: number;
  room_type: RoomType;
  total_combat_turns: number;
  player_metrics: RawPlayerFloorMetric[];
  log_parsed?: boolean;
}

export interface RawRunSaveData {
  run_id: string;
  is_multiplayer: boolean;
  player_count: number;
  players: PlayerInfo[];
  floors: RawFloorEntry[];
  run_status: 'ACTIVE' | 'VICTORY' | 'DEFEAT';
  current_floor?: number;
  in_reward_stage?: boolean;
}

// Engine & State Ledger Data Contracts
export interface PlayerFloorEvaluation {
  turns_taken_n: number;
  player_died: boolean;
  deaths_accumulated_d: number;
  hp_lost_h: number;
  formula: string;
  counters_added: number;
}

export interface PlayerDebtState {
  unresolved_counters: number;
  squat_ratio: number;
}

export interface PlayerAggregates {
  total_counters_accrued: number;
  completed_pushups: number;
  completed_squats: number;
}

export interface PlayerFloorReport {
  player_index: number;
  player_name: string;
  evaluation: PlayerFloorEvaluation;
  debt_state: PlayerDebtState;
  aggregates: PlayerAggregates;
}

export interface FloorCommitData {
  floor: number;
  room_type: RoomType;
  players: PlayerFloorReport[];
}

// WebSocket Event Contracts
export interface RunDetectedEvent {
  type: 'RUN_DETECTED';
  timestamp: number;
  data: {
    run_id: string;
    is_multiplayer: boolean;
    player_count: number;
    players: PlayerInfo[];
    default_squat_ratio: number;
  };
}

export interface FloorCommittedEvent {
  type: 'WORKOUT_FLOOR_COMMITTED';
  timestamp: number;
  data: FloorCommitData;
}

export interface PartyMemberSummary {
  player_index: number;
  player_name: string;
  squat_ratio: number;
  final_unresolved_debt: number;
  total_pushups: number;
  total_squats: number;
  deaths: number;
}

export interface RunTerminatedEvent {
  type: 'RUN_TERMINATED';
  timestamp: number;
  data: {
    outcome: 'VICTORY' | 'DEFEAT';
    floor_reached: number;
    jog_penalty_required: boolean;
    jog_deadline_timestamp: number | null;
    party_summary: PartyMemberSummary[];
  };
}

export interface StateUpdateEvent {
  type: 'STATE_UPDATE';
  timestamp: number;
  data: ActiveSessionStore;
}

export type WebSocketMessage = RunDetectedEvent | FloorCommittedEvent | RunTerminatedEvent | StateUpdateEvent;

// REST API Contracts
export type RepResolutionAction = 'CUSTOM_ENTRY' | 'ALL_PUSHUPS' | 'ALL_SQUATS';
export type ExerciseType = 'pushups' | 'squats';

export interface ResolveRepsPayload {
  player_index: number;
  action_type: RepResolutionAction;
  exercise?: ExerciseType;
  reps?: number;
  applied_ratio?: number;
}

export interface UpdateRatioPayload {
  player_index?: number;
  squat_ratio?: number;
  ratio?: number;
}

export interface CommitPendingPayload {
  player_index?: number;
}

export interface UpdateDeathsPayload {
  player_index: number;
  deaths: number;
}

export interface StartSessionPayload {
  opt_in: boolean;
  squat_ratio: number;
}