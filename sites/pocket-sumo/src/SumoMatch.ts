import { mulberry32, type PlayerSetup } from '@pocket/party-kit';
import { botDecision } from './bot';
import {
  ARENA_RADIUS, BUMPER_RADIUS, createFighter, DASH_COOLDOWN, FIGHTER_RADIUS, placeInCircle, PUFF_COOLDOWN, queueDash,
  setInput, stepWorld, type ArenaRules, type Fighter, type SumoEvent, type WorldState,
} from './physics';

export const COUNTDOWN_SECONDS = 3;
export const ROUND_END_SECONDS = 3.4;
/** Ai thắng đủ ngần này vòng trước thì thắng trận. */
export const WIN_ROUNDS = 3;
const MAX_ROUNDS = 9;
export const RING_WIDTH = 40;
export const MIN_RADIUS = 100;
export const FIRST_CRUMBLE = 14;
export const CRUMBLE_EVERY = 9;
export const WARN_SECONDS = 3;
/** Sàn đã nhỏ nhất thêm ngần này giây thì bắt đầu co liên tục tới khi hết chỗ đứng. */
const SUDDEN_DEATH_AFTER = 8;
const SUDDEN_DEATH_SPEED = 14;
const FINISH_SLOWMO_SECONDS = 1.1;
const PRACTICE_RESPAWN_RADIUS = 130;
export const STEP_SECONDS = 1 / 120;

export type MatchPhase = 'practice' | 'countdown' | 'fight' | 'roundEnd' | 'matchEnd';
export type RoundVariant = 'classic' | 'ice' | 'bumpers';
export const VARIANT_LABELS: Record<RoundVariant, string> = {
  classic: 'Sàn gỗ',
  ice: 'Sàn băng · trượt dài',
  bumpers: 'Cột nảy · chạm là văng',
};
const VARIANT_ORDER: RoundVariant[] = ['classic', 'ice', 'bumpers'];

export interface FighterSetup extends PlayerSetup {
  key: string;
  /** Có giá trị nghĩa là bot, với trình độ 0..1. */
  botSkill?: number;
}

export type MatchEvent =
  | SumoEvent
  | { type: 'tick'; value: number }
  | { type: 'go' }
  | { type: 'warn' }
  | { type: 'crumble'; from: number; to: number }
  | { type: 'roundEnd'; winner: string | null }
  | { type: 'matchEnd'; winner: string }
  | { type: 'spawn'; key: string };

export interface FighterView {
  key: string;
  name: string;
  color: string;
  bot: boolean;
  autopilot: boolean;
  status: Fighter['status'];
  wins: number;
  kos: number;
  /** 0..1: sát mép hoặc đứng trên vòng sàn sắp sụp. */
  danger: number;
  /** 0..1 phần hồi chiêu còn lại (húc hoặc thổi). */
  cooldown: number;
}

/** Bản tóm tắt gửi cho điện thoại ~8 lần/giây. */
export interface SumoView {
  phase: MatchPhase;
  round: number;
  winRounds: number;
  variant: RoundVariant;
  countdown: number;
  alive: number;
  roundWinner: string | null;
  matchWinner: string | null;
  fighters: FighterView[];
  /** Key theo thứ hạng hiện tại. */
  ranking: string[];
}

interface Score { wins: number; kos: number; falls: number }

export class SumoMatch {
  readonly world: WorldState;
  phase: MatchPhase;
  round = 0;
  variant: RoundVariant = 'classic';
  /** Bán kính sau lần sụp kế tiếp; bằng world.radius khi không có cảnh báo. */
  nextRadius = ARENA_RADIUS;
  /** Thời điểm (giây trong vòng) vòng ngoài sụp tiếp theo. */
  private crumbleAt = FIRST_CRUMBLE;
  private warned = false;
  private reachedMinAt: number | null = null;
  /** Đồng hồ trong vòng; âm khi đang đếm ngược. */
  clock = 0;
  roundWinner: string | null = null;
  matchWinner: string | null = null;
  slowmo = 0;
  private phaseTimer = 0;
  private lastTick = 0;
  private accumulator = 0;
  private readonly scores = new Map<string, Score>();
  private readonly random: () => number;

  constructor(players: FighterSetup[], options: { practice?: boolean; seed?: number } = {}) {
    this.random = mulberry32(options.seed ?? Math.floor(Math.random() * 2 ** 31));
    this.world = { fighters: [], radius: ARENA_RADIUS, rules: { ice: false, bumpers: [] }, time: 0 };
    this.phase = options.practice ? 'practice' : 'countdown';
    players.forEach((player) => this.addFighter(player));
    if (!options.practice) this.startRound();
    else placeInCircle(this.world.fighters, ARENA_RADIUS * 0.4, this.random() * Math.PI * 2);
  }

  get fighters(): Fighter[] {
    return this.world.fighters;
  }

  get practice(): boolean {
    return this.phase === 'practice';
  }

  fighter(key: string): Fighter | undefined {
    return this.world.fighters.find((fighter) => fighter.key === key);
  }

  addFighter(player: FighterSetup): Fighter {
    const existing = this.fighter(player.key);
    if (existing) {
      existing.name = player.name;
      existing.color = player.color;
      return existing;
    }
    const fighter = createFighter(player.key, player.name, player.color, player.botSkill);
    this.world.fighters.push(fighter);
    this.scores.set(player.key, { wins: 0, kos: 0, falls: 0 });
    if (this.practice) this.respawn(fighter);
    return fighter;
  }

  /** Chỉ dùng ở sảnh khởi động: người rời phòng thì nhân vật biến mất. */
  removeFighter(key: string): void {
    if (!this.practice) return;
    this.world.fighters = this.world.fighters.filter((fighter) => fighter.key !== key);
    this.scores.delete(key);
  }

  setInput(key: string, x: number, y: number): void {
    const fighter = this.fighter(key);
    if (fighter && !fighter.bot && !fighter.autopilot) setInput(fighter, x, y);
  }

  /** Điện thoại vừa được chạm: TV sáng vòng dưới chân để người chơi nhận ra mình. */
  touch(key: string): void {
    const fighter = this.fighter(key);
    if (fighter) fighter.touchedAt = this.world.time;
  }

  dash(key: string, x: number, y: number): boolean {
    const fighter = this.fighter(key);
    if (!fighter || fighter.bot || fighter.autopilot) return false;
    if (this.phase !== 'fight' && this.phase !== 'practice') return false;
    return queueDash(fighter, x, y);
  }

  setAutopilot(key: string, enabled: boolean): void {
    const fighter = this.fighter(key);
    if (!fighter || fighter.bot) return;
    fighter.autopilot = enabled && !this.practice;
    if (!fighter.autopilot) setInput(fighter, 0, 0);
  }

  /** Tiến mô phỏng theo thời gian thực `elapsed` (giây), bằng các bước cố định; có làm chậm khi hạ gục cuối. */
  advance(elapsed: number): MatchEvent[] {
    const events: MatchEvent[] = [];
    let scaled = Math.min(0.1, elapsed);
    if (this.slowmo > 0) {
      this.slowmo = Math.max(0, this.slowmo - scaled);
      scaled *= 0.35;
    }
    this.accumulator += scaled;
    while (this.accumulator >= STEP_SECONDS) {
      this.accumulator -= STEP_SECONDS;
      this.step(STEP_SECONDS, events);
    }
    return events;
  }

  step(dt: number, events: MatchEvent[] = []): MatchEvent[] {
    if (this.phase === 'matchEnd') {
      this.stepPhysics(dt, events);
      return events;
    }
    if (this.phase === 'practice') {
      this.stepPractice(dt, events);
      return events;
    }
    if (this.phase === 'countdown') {
      this.clock += dt;
      const remaining = Math.ceil(-this.clock);
      if (remaining !== this.lastTick && remaining > 0) {
        this.lastTick = remaining;
        events.push({ type: 'tick', value: remaining });
      }
      if (this.clock >= 0) {
        this.phase = 'fight';
        events.push({ type: 'go' });
      }
      return events;
    }
    if (this.phase === 'roundEnd') {
      this.phaseTimer -= dt;
      this.stepPhysics(dt, events);
      if (this.phaseTimer <= 0) this.nextRound(events);
      return events;
    }

    this.clock += dt;
    this.shrinkArena(dt, events);
    this.stepPhysics(dt, events);
    const alive = this.world.fighters.filter((fighter) => fighter.status === 'alive');
    if (this.world.fighters.length > 1 && alive.length <= 1) this.finishRound(alive[0] ?? null, events);
    return events;
  }

  private stepPhysics(dt: number, events: MatchEvent[]): void {
    this.world.time += dt;
    const frozen = this.phase === 'roundEnd' || this.phase === 'matchEnd' || this.phase === 'countdown';
    for (const fighter of this.world.fighters) {
      if (frozen) {
        setInput(fighter, 0, 0);
        fighter.dashBuffer = null;
      } else if (fighter.bot || fighter.autopilot) {
        const decision = botDecision(fighter, this.world, this.random);
        setInput(fighter, decision.x, decision.y);
        if (decision.dash) queueDash(fighter, decision.x, decision.y);
      }
    }
    const physics: SumoEvent[] = [];
    stepWorld(this.world, dt, physics);
    for (const event of physics) {
      if (event.type === 'fall' && this.phase === 'fight') {
        const score = this.scores.get(event.key);
        if (score) score.falls += 1;
        if (event.other) {
          const credit = this.scores.get(event.other);
          if (credit) credit.kos += 1;
        }
      }
      events.push(event);
    }
  }

  private stepPractice(dt: number, events: MatchEvent[]): void {
    this.stepPhysics(dt, events);
    for (const fighter of this.world.fighters) {
      if (fighter.status !== 'ghost') continue;
      this.respawn(fighter);
      events.push({ type: 'spawn', key: fighter.key });
    }
  }

  private respawn(fighter: Fighter): void {
    let best = { x: 0, y: 0, room: -1 };
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * PRACTICE_RESPAWN_RADIUS;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const room = Math.min(Infinity, ...this.world.fighters
        .filter((other) => other !== fighter && other.status === 'alive')
        .map((other) => Math.hypot(other.x - x, other.y - y)));
      if (room > best.room) best = { x, y, room };
      if (room > FIGHTER_RADIUS * 4) break;
    }
    Object.assign(fighter, {
      x: best.x, y: best.y, vx: 0, vy: 0, status: 'alive', dash: 0, dashCooldown: 0, dashBuffer: null,
      stun: 0, fallTimer: 0, lastHitBy: null, impact: 0,
    });
  }

  private shrinkArena(dt: number, events: MatchEvent[]): void {
    const world = this.world;
    if (world.radius > MIN_RADIUS + 0.5) {
      if (!this.warned && this.clock >= this.crumbleAt - WARN_SECONDS) {
        this.warned = true;
        this.nextRadius = Math.max(MIN_RADIUS, world.radius - RING_WIDTH);
        events.push({ type: 'warn' });
      }
      if (this.clock >= this.crumbleAt) {
        const from = world.radius;
        world.radius = this.nextRadius;
        this.warned = false;
        this.crumbleAt += CRUMBLE_EVERY;
        // Cột nảy nằm trên vòng vừa sụp thì rơi theo.
        world.rules.bumpers = world.rules.bumpers.filter((bumper) => Math.hypot(bumper.x, bumper.y) + BUMPER_RADIUS * 0.5 < world.radius);
        events.push({ type: 'crumble', from, to: world.radius });
        if (world.radius <= MIN_RADIUS + 0.5) this.reachedMinAt = this.clock;
      }
      return;
    }
    if (this.reachedMinAt !== null && this.clock - this.reachedMinAt > SUDDEN_DEATH_AFTER) {
      // Hết giờ: sàn co dần tới khi chỉ còn một người trụ lại.
      world.radius = Math.max(0, world.radius - SUDDEN_DEATH_SPEED * dt);
      this.nextRadius = world.radius;
      world.rules.bumpers = world.rules.bumpers.filter((bumper) => Math.hypot(bumper.x, bumper.y) < world.radius);
    }
  }

  private finishRound(winner: Fighter | null, events: MatchEvent[]): void {
    this.phase = 'roundEnd';
    this.phaseTimer = ROUND_END_SECONDS;
    this.slowmo = FINISH_SLOWMO_SECONDS;
    this.roundWinner = winner?.key ?? null;
    const score = winner ? this.scores.get(winner.key) : undefined;
    if (score) score.wins += 1;
    events.push({ type: 'roundEnd', winner: this.roundWinner });
  }

  private nextRound(events: MatchEvent[]): void {
    const leader = this.ranking()[0];
    const leaderWins = leader ? this.scores.get(leader)?.wins ?? 0 : 0;
    if (leader && (leaderWins >= WIN_ROUNDS || this.round >= MAX_ROUNDS)) {
      this.phase = 'matchEnd';
      this.matchWinner = leader;
      events.push({ type: 'matchEnd', winner: leader });
      return;
    }
    this.startRound();
  }

  private startRound(): void {
    this.round += 1;
    this.variant = this.round <= VARIANT_ORDER.length
      ? VARIANT_ORDER[this.round - 1]!
      : VARIANT_ORDER[Math.floor(this.random() * VARIANT_ORDER.length)]!;
    this.world.radius = ARENA_RADIUS;
    this.nextRadius = ARENA_RADIUS;
    this.world.rules = rulesFor(this.variant, this.random() * Math.PI * 2);
    this.crumbleAt = FIRST_CRUMBLE;
    this.warned = false;
    this.reachedMinAt = null;
    this.roundWinner = null;
    this.clock = -COUNTDOWN_SECONDS;
    this.lastTick = 0;
    this.phase = 'countdown';
    placeInCircle(this.world.fighters, ARENA_RADIUS * 0.58, -Math.PI / 2 + this.round * 0.9);
  }

  /** Thắng nhiều vòng hơn → hất văng nhiều hơn → rơi ít hơn. */
  ranking(): string[] {
    return this.world.fighters.map((fighter) => fighter.key).sort((a, b) => {
      const sa = this.scores.get(a)!;
      const sb = this.scores.get(b)!;
      return sb.wins - sa.wins || sb.kos - sa.kos || sa.falls - sb.falls;
    });
  }

  score(key: string): { wins: number; kos: number; falls: number } {
    const score = this.scores.get(key);
    return { wins: score?.wins ?? 0, kos: score?.kos ?? 0, falls: score?.falls ?? 0 };
  }

  danger(fighter: Fighter): number {
    if (fighter.status !== 'alive') return 0;
    const distance = Math.hypot(fighter.x, fighter.y);
    const edge = Math.max(0, Math.min(1, (distance - (this.world.radius - 75)) / 60));
    const doomed = this.warned && distance > this.nextRadius - FIGHTER_RADIUS * 0.5 ? 0.85 : 0;
    return Math.max(edge, doomed);
  }

  /** 0..1 thời gian còn lại của cảnh báo sụp sàn (1 là vừa bắt đầu cảnh báo); 0 khi không cảnh báo. */
  get warning(): number {
    if (!this.warned || this.phase !== 'fight') return 0;
    return Math.max(0, Math.min(1, (this.crumbleAt - this.clock) / WARN_SECONDS));
  }

  view(): SumoView {
    const alive = this.world.fighters.filter((fighter) => fighter.status === 'alive').length;
    return {
      phase: this.phase,
      round: this.round,
      winRounds: WIN_ROUNDS,
      variant: this.variant,
      countdown: Math.max(0, -this.clock),
      alive,
      roundWinner: this.roundWinner,
      matchWinner: this.matchWinner,
      ranking: this.ranking(),
      fighters: this.world.fighters.map((fighter) => {
        const score = this.score(fighter.key);
        const full = fighter.status === 'ghost' ? PUFF_COOLDOWN : DASH_COOLDOWN;
        return {
          key: fighter.key,
          name: fighter.name,
          color: fighter.color,
          bot: fighter.bot,
          autopilot: fighter.autopilot,
          status: fighter.status,
          wins: score.wins,
          kos: score.kos,
          danger: round2(this.danger(fighter)),
          cooldown: round2(Math.min(1, fighter.dashCooldown / full)),
        };
      }),
    };
  }
}

function rulesFor(variant: RoundVariant, rotation: number): ArenaRules {
  if (variant === 'ice') return { ice: true, bumpers: [] };
  if (variant === 'bumpers') {
    return {
      ice: false,
      bumpers: [0, 1, 2].map((index) => {
        const angle = rotation + (index / 3) * Math.PI * 2;
        return { x: Math.cos(angle) * 105, y: Math.sin(angle) * 105 };
      }),
    };
  }
  return { ice: false, bumpers: [] };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
