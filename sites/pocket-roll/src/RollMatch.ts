import type { PlayerSetup } from '@pocket/party-kit';
import { botInput, createBotMemory, type BotMemory } from './bot';
import { LEVELS } from './levels';
import {
  collideRolls, createRoll, createWorld, queueJump, stepRoll, stepWorld, type Level, type RollEvent, type RollState, type WorldState,
} from './physics';

export const COUNTDOWN_SECONDS = 3;
/** Sau khi người đầu tiên giao giấy, những người còn lại có ngần này giây. */
export const FINISH_GRACE_SECONDS = 25;
export const MAX_LEVEL_SECONDS = 150;
/** Kết quả màn hiện ngần này giây rồi tự sang màn sau (hoặc chơi lại nếu chưa ai qua). */
export const LEVEL_END_SECONDS = 9;
/** Điểm theo thứ tự giao giấy; ai qua màn cũng có ít nhất 1 điểm. */
const PLACE_POINTS = [5, 3, 2];
const PRACTICE_RESPAWN_SECONDS = 1.4;
export const STEP_SECONDS = 1 / 120;

export type RollPhase = 'practice' | 'countdown' | 'playing' | 'levelEnd' | 'matchEnd';

export interface RollerSetup extends PlayerSetup {
  key: string;
  bot?: boolean;
}

export interface Roller extends PlayerSetup {
  key: string;
  bot: boolean;
  roll: RollState;
  tilt: number;
  memory: BotMemory;
  /** Thời điểm chạm vào điện thoại gần nhất (để TV nháy vòng sáng nhận diện). */
  touchedAt: number;
  points: number;
  levelPoints: number;
  totalDeaths: number;
  cleared: number;
  /** Ở sàn khởi động: giao xong thì chờ chút rồi lăn lại từ đầu. */
  doneTimer: number;
}

export interface RollerView {
  key: string;
  name: string;
  color: string;
  bot: boolean;
  status: RollState['status'];
  deaths: number;
  finishTime: number | null;
  points: number;
  levelPoints: number;
}

/** Bản tóm tắt gửi cho điện thoại ~8 lần/giây. */
export interface RollView {
  phase: RollPhase;
  levelIndex: number;
  levelCount: number;
  levelName: string;
  hint: string;
  countdown: number;
  time: number;
  graceLeft: number | null;
  /** Còn bao nhiêu giây thì tự chuyển màn (khi đang xem kết quả màn). */
  nextIn: number | null;
  /** Có ai qua màn này chưa: chưa ai qua thì màn được chơi lại. */
  cleared: boolean;
  rollers: RollerView[];
  /** Key theo thứ hạng của màn đang chơi (khi hết trận: theo tổng điểm). */
  ranking: string[];
}

export type MatchEvent =
  | { roller: number; event: RollEvent }
  | { roller: -1; event: { type: 'tick'; value: number } | { type: 'go' } | { type: 'levelEnd'; cleared: boolean } | { type: 'matchEnd' } };

export class RollMatch {
  phase: RollPhase;
  levelIndex: number;
  world: WorldState;
  readonly rollers: Roller[] = [];
  /** Đồng hồ trong màn; âm khi đang đếm ngược. */
  clock = 0;
  private graceUntil: number | null = null;
  private phaseTimer = 0;
  private lastTick = 0;
  private accumulator = 0;

  constructor(players: RollerSetup[], options: { level?: number; practice?: boolean } = {}) {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, options.level ?? 0));
    this.world = createWorld(this.level);
    this.phase = options.practice ? 'practice' : 'countdown';
    players.forEach((player) => this.addRoller(player));
    if (!options.practice) this.startLevel(this.levelIndex);
  }

  get level(): Level {
    return LEVELS[this.levelIndex]!;
  }

  get practice(): boolean {
    return this.phase === 'practice';
  }

  get isLastLevel(): boolean {
    return this.levelIndex >= LEVELS.length - 1;
  }

  roller(key: string): Roller | undefined {
    return this.rollers.find((roller) => roller.key === key);
  }

  addRoller(player: RollerSetup): Roller {
    const existing = this.roller(player.key);
    if (existing) {
      existing.name = player.name;
      existing.color = player.color;
      return existing;
    }
    const roll = createRoll(this.level);
    if (this.practice) roll.status = 'rolling';
    const roller: Roller = {
      key: player.key, name: player.name, color: player.color, bot: Boolean(player.bot), roll, tilt: 0,
      memory: createBotMemory(), touchedAt: -Infinity, points: 0, levelPoints: 0, totalDeaths: 0, cleared: 0, doneTimer: 0,
    };
    this.rollers.push(roller);
    return roller;
  }

  /** Chỉ dùng ở sàn khởi động: người rời phòng thì cuộn giấy biến mất. */
  removeRoller(key: string): void {
    if (!this.practice) return;
    const index = this.rollers.findIndex((roller) => roller.key === key);
    if (index !== -1) this.rollers.splice(index, 1);
  }

  /** Đổi màn ở sàn khởi động (chọn màn ở sảnh chờ thì được lăn thử ngay màn đó). */
  setPracticeLevel(index: number): void {
    if (!this.practice) return;
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.world = createWorld(this.level);
    this.rollers.forEach((roller) => this.resetRoller(roller, true));
  }

  setTilt(key: string, tilt: number): void {
    const roller = this.roller(key);
    if (roller && !roller.bot && Number.isFinite(tilt)) roller.tilt = Math.max(-1, Math.min(1, tilt));
  }

  jump(key: string): boolean {
    const roller = this.roller(key);
    if (!roller || roller.bot || roller.roll.status !== 'rolling') return false;
    queueJump(roller.roll);
    return true;
  }

  touch(key: string): void {
    const roller = this.roller(key);
    if (roller) roller.touchedAt = this.world.time;
  }

  /** Tiến mô phỏng theo thời gian thực `elapsed` (giây), bằng các bước cố định. */
  advance(elapsed: number): MatchEvent[] {
    const events: MatchEvent[] = [];
    this.accumulator += Math.min(0.1, elapsed);
    while (this.accumulator >= STEP_SECONDS) {
      this.accumulator -= STEP_SECONDS;
      this.step(STEP_SECONDS, events);
    }
    return events;
  }

  step(dt: number, events: MatchEvent[] = []): MatchEvent[] {
    if (this.phase === 'countdown') {
      // Cưa và bục đứng yên trong lúc đếm ngược; đồng hồ màn (world.time) bắt đầu từ lúc "Lăn!".
      this.clock += dt;
      const remaining = Math.ceil(-this.clock);
      if (remaining !== this.lastTick && remaining > 0) {
        this.lastTick = remaining;
        events.push({ roller: -1, event: { type: 'tick', value: remaining } });
      }
      if (this.clock >= 0) {
        this.phase = 'playing';
        this.rollers.forEach((roller) => { roller.roll.status = 'rolling'; });
        events.push({ roller: -1, event: { type: 'go' } });
      }
      return events;
    }
    if (this.phase === 'levelEnd') {
      this.phaseTimer -= dt;
      this.stepPhysics(dt, events);
      if (this.phaseTimer <= 0) this.continueAfterLevel();
      return events;
    }
    this.clock += dt;
    this.stepPhysics(dt, events);
    if (this.phase === 'practice') {
      for (const roller of this.rollers) {
        if (roller.roll.status !== 'done') continue;
        roller.doneTimer += dt;
        if (roller.doneTimer > PRACTICE_RESPAWN_SECONDS) this.resetRoller(roller, true);
      }
      return events;
    }
    if (this.phase === 'playing') {
      const done = this.rollers.filter((roller) => roller.roll.status === 'done').length;
      if (done > 0 && this.graceUntil === null) this.graceUntil = this.clock + FINISH_GRACE_SECONDS;
      if (done === this.rollers.length || (this.graceUntil !== null && this.clock >= this.graceUntil) || this.clock >= MAX_LEVEL_SECONDS) {
        this.finishLevel(events);
      }
    }
    return events;
  }

  private stepPhysics(dt: number, events: MatchEvent[]): void {
    const rolls = this.rollers.map((roller) => roller.roll);
    stepWorld(this.world, rolls, dt);
    this.rollers.forEach((roller, index) => {
      let tilt = roller.tilt;
      if (roller.bot) {
        const input = botInput(roller.roll, this.level, roller.memory, this.world.time);
        tilt = input.tilt;
        if (input.jump) queueJump(roller.roll);
      }
      const rollEvents: RollEvent[] = [];
      stepRoll(roller.roll, this.phase === 'levelEnd' ? 0 : tilt, this.world, dt, rollEvents);
      rollEvents.forEach((event) => {
        if (event.type === 'die' && !this.practice) roller.totalDeaths += 1;
        if (event.type === 'goal' && !this.practice) this.award(roller);
        events.push({ roller: index, event });
      });
    });
    const bumps: Array<{ index: number; event: RollEvent }> = [];
    collideRolls(rolls, bumps);
    bumps.forEach(({ index, event }) => events.push({ roller: index, event }));
  }

  private award(roller: Roller): void {
    const place = this.rollers.filter((other) => other.roll.status === 'done').length - 1;
    roller.levelPoints = PLACE_POINTS[place] ?? 1;
    roller.points += roller.levelPoints;
    roller.cleared += 1;
  }

  private finishLevel(events: MatchEvent[]): void {
    const cleared = this.rollers.some((roller) => roller.roll.status === 'done');
    this.phase = 'levelEnd';
    this.phaseTimer = LEVEL_END_SECONDS;
    events.push({ roller: -1, event: { type: 'levelEnd', cleared } });
    if (cleared && this.isLastLevel) {
      this.phase = 'matchEnd';
      events.push({ roller: -1, event: { type: 'matchEnd' } });
    }
  }

  /** Hết giờ xem kết quả: qua màn thì sang màn sau, chưa ai qua thì chơi lại. */
  private continueAfterLevel(): void {
    const cleared = this.rollers.some((roller) => roller.roll.status === 'done');
    this.startLevel(cleared ? this.levelIndex + 1 : this.levelIndex);
  }

  /** Bấm "màn tiếp" hoặc "chơi lại" khi đang xem kết quả (chủ phòng hoặc TV). */
  goTo(next: 'next' | 'retry'): boolean {
    if (this.phase !== 'levelEnd') return false;
    if (next === 'next' && this.isLastLevel) return false;
    this.startLevel(next === 'next' ? this.levelIndex + 1 : this.levelIndex);
    return true;
  }

  startLevel(index: number): void {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.world = createWorld(this.level);
    this.phase = 'countdown';
    this.clock = -COUNTDOWN_SECONDS;
    this.lastTick = 0;
    this.graceUntil = null;
    this.rollers.forEach((roller) => this.resetRoller(roller, false));
  }

  private resetRoller(roller: Roller, rolling: boolean): void {
    roller.roll = createRoll(this.level);
    if (rolling) roller.roll.status = 'rolling';
    roller.memory = createBotMemory();
    roller.levelPoints = 0;
    roller.doneTimer = 0;
    roller.tilt = 0;
  }

  /** Thứ hạng trong màn: giao giấy sớm hơn → chết ít hơn → gần đích hơn. Hết trận thì theo tổng điểm. */
  ranking(): string[] {
    const goal = this.level.goal;
    const distance = (roller: Roller) => Math.hypot(roller.roll.x - (goal.x + goal.w / 2), roller.roll.y - (goal.y + goal.h / 2));
    return [...this.rollers].sort((a, b) => {
      if (this.phase === 'matchEnd') return b.points - a.points || a.totalDeaths - b.totalDeaths;
      const ta = a.roll.finishTime;
      const tb = b.roll.finishTime;
      if (ta !== null && tb !== null) return ta - tb;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return a.roll.deaths - b.roll.deaths || distance(a) - distance(b);
    }).map((roller) => roller.key);
  }

  view(): RollView {
    return {
      phase: this.phase,
      levelIndex: this.levelIndex,
      levelCount: LEVELS.length,
      levelName: this.level.name,
      hint: this.level.hint,
      countdown: Math.max(0, -this.clock),
      time: Math.max(0, this.clock),
      graceLeft: this.graceUntil === null || this.phase !== 'playing' ? null : Math.max(0, this.graceUntil - this.clock),
      nextIn: this.phase === 'levelEnd' ? Math.max(0, this.phaseTimer) : null,
      cleared: this.rollers.some((roller) => roller.roll.status === 'done'),
      ranking: this.ranking(),
      rollers: this.rollers.map((roller) => ({
        key: roller.key,
        name: roller.name,
        color: roller.color,
        bot: roller.bot,
        status: roller.roll.status,
        deaths: roller.roll.deaths,
        finishTime: roller.roll.finishTime === null ? null : Math.round(roller.roll.finishTime * 10) / 10,
        points: roller.points,
        levelPoints: roller.levelPoints,
      })),
    };
  }
}
