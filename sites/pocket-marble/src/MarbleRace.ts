import type { PlayerSetup } from '@pocket/party-kit';
import { botInput } from './bot';
import { generateCourse, LANE_WIDTH, type Course } from './course';
import { createMarble, stepMarble, stepTray, type MarbleEvent, type MarbleState, type TrayState } from './physics';

export const COUNTDOWN_SECONDS = 3;
/** Sau khi người đầu tiên về đích, những người còn lại có ngần này giây. */
export const FINISH_GRACE_SECONDS = 20;
export const MAX_RACE_SECONDS = 150;
/** Mỗi viên ngọc trừ ngần này giây vào thành tích. */
export const GEM_BONUS_SECONDS = 0.5;
/** Rơi hố hoặc làm rơi bi khỏi khay mất một mạng; hết mạng là bị loại. */
export const LIVES = 3;
const DROP_STUN_SECONDS = 1.2;
const JUMP_BUFFER_SECONDS = 0.15;
export const STEP_SECONDS = 1 / 120;

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RacerSetup extends PlayerSetup {
  /** Có giá trị nghĩa là bot, với trình độ 0..1. */
  botSkill?: number;
}

export interface Racer extends PlayerSetup {
  bot: boolean;
  botSkill: number;
  marble: MarbleState;
  tray: TrayState;
  tilt: number;
  jumpBuffer: number;
  drops: number;
  lives: number;
}

export interface RacerView {
  name: string;
  color: string;
  bot: boolean;
  progress: number;
  gems: number;
  status: MarbleState['status'];
  stunned: boolean;
  finishTime: number | null;
  score: number | null;
  rank: number;
  drops: number;
  lives: number;
  tray: number;
}

/** Bản tóm tắt gửi cho điện thoại ~5 lần/giây. */
export interface RaceView {
  phase: RacePhase;
  countdown: number;
  time: number;
  graceLeft: number | null;
  gemCount: number;
  racers: RacerView[];
}

export interface RaceEvent { racer: number; type: MarbleEvent }

export class MarbleRace {
  readonly course: Course;
  readonly racers: Racer[];
  phase: RacePhase = 'countdown';
  /** Đồng hồ cuộc đua; âm trong lúc đếm ngược. */
  time = -COUNTDOWN_SECONDS;
  private graceUntil: number | null = null;
  private accumulator = 0;

  constructor(players: RacerSetup[], seed = Math.floor(Math.random() * 2 ** 31)) {
    this.course = generateCourse(seed);
    this.racers = players.map(({ name, color, botSkill }) => ({
      name,
      color,
      bot: botSkill !== undefined,
      botSkill: botSkill ?? 1,
      marble: createMarble(LANE_WIDTH / 2),
      tray: { position: 0, velocity: 0 },
      tilt: 0,
      jumpBuffer: 0,
      drops: 0,
      lives: LIVES,
    }));
  }

  setTilt(index: number, tilt: number): void {
    const racer = this.racers[index];
    if (racer && Number.isFinite(tilt)) racer.tilt = Math.max(-1, Math.min(1, tilt));
  }

  jump(index: number): void {
    const racer = this.racers[index];
    if (racer) racer.jumpBuffer = JUMP_BUFFER_SECONDS;
  }

  /** Tiến mô phỏng theo thời gian thực `elapsed` (giây), bằng các bước cố định. */
  advance(elapsed: number): RaceEvent[] {
    const events: RaceEvent[] = [];
    this.accumulator += Math.min(0.1, elapsed);
    while (this.accumulator >= STEP_SECONDS) {
      this.accumulator -= STEP_SECONDS;
      this.step(STEP_SECONDS, events);
    }
    return events;
  }

  step(dt: number, events: RaceEvent[] = []): RaceEvent[] {
    if (this.phase === 'finished') return events;
    this.time += dt;
    if (this.phase === 'countdown') {
      if (this.time < 0) return events;
      this.phase = 'racing';
      this.racers.forEach((racer) => { racer.marble.status = 'rolling'; });
    }

    this.racers.forEach((racer, index) => {
      const marbleEvents: MarbleEvent[] = [];
      if (racer.bot && racer.marble.status === 'rolling') {
        // Đổi "vận may" mỗi lần mất mạng: lỡ một hố rồi được đặt lại trước nó thì không lỡ mãi đúng hố đó.
        const input = botInput(racer.marble, this.course, this.time, racer.botSkill, (index + 1) * 10 + racer.lives);
        racer.tilt = input.tilt;
        if (input.jump) racer.jumpBuffer = JUMP_BUFFER_SECONDS;
      }
      // Khay nằm trong tay người chơi nên vẫn lăn cả khi bi trên đường đang rơi hố.
      const inPlay = racer.marble.status === 'rolling' || racer.marble.status === 'falling';
      if (inPlay && stepTray(racer.tray, racer.tilt, dt)) {
        racer.drops += 1;
        racer.lives -= 1;
        racer.marble.stun = Math.max(racer.marble.stun, DROP_STUN_SECONDS);
        marbleEvents.push('drop');
        if (racer.lives <= 0) this.eliminate(racer, marbleEvents);
      }
      const jump = racer.jumpBuffer > 0;
      stepMarble(racer.marble, { tilt: racer.tilt, jump }, this.course, this.time, dt, marbleEvents);
      if (marbleEvents.includes('fall')) racer.lives -= 1;
      // Rơi hố mạng cuối: xem hết cảnh rơi rồi mới bị loại, thay vì được đặt lại.
      const respawn = marbleEvents.indexOf('respawn');
      if (respawn !== -1 && racer.lives <= 0) {
        marbleEvents.splice(respawn, 1);
        this.eliminate(racer, marbleEvents);
      }
      if (marbleEvents.includes('jump')) racer.jumpBuffer = 0;
      else racer.jumpBuffer = Math.max(0, racer.jumpBuffer - dt);
      marbleEvents.forEach((type) => events.push({ racer: index, type }));
    });

    const finished = this.racers.filter((racer) => racer.marble.status === 'finished').length;
    const out = this.racers.filter((racer) => racer.marble.status === 'out').length;
    if (finished > 0 && this.graceUntil === null) this.graceUntil = this.time + FINISH_GRACE_SECONDS;
    if (finished + out === this.racers.length
      || (this.graceUntil !== null && this.time >= this.graceUntil)
      || this.time >= MAX_RACE_SECONDS) {
      this.phase = 'finished';
    }
    return events;
  }

  private eliminate(racer: Racer, events: MarbleEvent[]): void {
    racer.lives = 0;
    Object.assign(racer.marble, { status: 'out', vx: 0, vy: 0, z: 0, vz: 0 });
    events.push('out');
  }

  score(racer: Racer): number | null {
    const { finishTime } = racer.marble;
    return finishTime === null ? null : Math.max(0, finishTime - racer.marble.collected.size * GEM_BONUS_SECONDS);
  }

  /** Chỉ số racer theo thứ hạng: về đích xếp theo thành tích, rồi người còn đua, rồi người bị loại; cùng nhóm thì ai đi xa hơn xếp trên. */
  ranking(): number[] {
    const group = (racer: Racer) => (this.score(racer) !== null ? 0 : racer.marble.status === 'out' ? 2 : 1);
    return this.racers.map((_, index) => index).sort((a, b) => {
      const ra = this.racers[a]!;
      const rb = this.racers[b]!;
      const ga = group(ra);
      const gb = group(rb);
      if (ga !== gb) return ga - gb;
      if (ga === 0) return this.score(ra)! - this.score(rb)!;
      return rb.marble.y - ra.marble.y;
    });
  }

  view(): RaceView {
    const ranks = new Map(this.ranking().map((racer, rank) => [racer, rank + 1]));
    return {
      phase: this.phase,
      countdown: Math.max(0, -this.time),
      time: Math.max(0, this.time),
      graceLeft: this.graceUntil === null ? null : Math.max(0, this.graceUntil - this.time),
      gemCount: this.course.gemCount,
      racers: this.racers.map((racer, index) => ({
        name: racer.name,
        color: racer.color,
        bot: racer.bot,
        progress: Math.max(0, Math.min(1, racer.marble.y / this.course.length)),
        gems: racer.marble.collected.size,
        status: racer.marble.status,
        stunned: racer.marble.stun > 0,
        finishTime: racer.marble.finishTime,
        score: this.score(racer),
        rank: ranks.get(index) ?? index + 1,
        drops: racer.drops,
        lives: racer.lives,
        tray: racer.tray.position,
      })),
    };
  }
}
