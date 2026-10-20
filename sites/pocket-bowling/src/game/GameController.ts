import type { GameSnapshot, ThrowInput } from '../types';
import { AudioEngine } from '../audio/AudioEngine';
import { BowlingRenderer, type CameraMode, type QualityMode } from './BowlingRenderer';
import { FIXED_TIMESTEP, LANE_HALF_WIDTH, PhysicsLane } from './PhysicsLane';
import { GameSession, type PlayerLineup } from './GameSession';

export class GameController {
  readonly session: GameSession;
  readonly physics: PhysicsLane;
  readonly renderer: BowlingRenderer;
  readonly audio = new AudioEngine();
  onSnapshot?: (snapshot: GameSnapshot) => void;
  onControls?: (controls: { aim: number; position: number; power: number; spin: number }) => void;
  controls = { aim: 0, position: 0, power: 0.68, spin: 0 };
  private animation = 0;
  private previousTime = performance.now();
  private accumulator = 0;
  private transitionAt = 0;
  private scoringLocked = false;
  private reducedEffects = false;
  private impactPlayed = false;
  private gutterPlayed = false;

  constructor(container: HTMLElement, lineup: PlayerLineup = 1) {
    this.session = new GameSession(lineup);
    this.physics = new PhysicsLane();
    this.renderer = new BowlingRenderer(container, this.physics);
    this.animation = requestAnimationFrame(this.frame);
    this.emitSnapshot();
  }

  setControls(values: Partial<typeof this.controls>): void {
    if (!this.session.snapshot().canThrow) return;
    this.controls = {
      aim: Math.max(-1, Math.min(1, values.aim ?? this.controls.aim)),
      position: Math.max(-1, Math.min(1, values.position ?? this.controls.position)),
      power: Math.max(0.2, Math.min(1, values.power ?? this.controls.power)),
      spin: Math.max(-1, Math.min(1, values.spin ?? this.controls.spin)),
    };
    this.physics.setAimPosition(this.controls.position);
    this.onControls?.({ ...this.controls });
  }

  prepare(): boolean {
    const accepted = this.session.prepare();
    if (accepted) this.emitSnapshot();
    return accepted;
  }

  cancelPrepare(): void {
    this.session.cancelPrepare();
    this.emitSnapshot();
  }

  throw(commandId: string, input: ThrowInput): boolean {
    if (!this.session.beginThrow(commandId)) return false;
    this.setRawControls(input);
    this.physics.setAimPosition(this.controls.position);
    this.physics.launch(this.controls);
    this.audio.roll();
    this.scoringLocked = false;
    this.impactPlayed = false;
    this.gutterPlayed = false;
    this.emitSnapshot();
    return true;
  }

  restart(lineup?: PlayerLineup): void {
    this.session.reset(lineup);
    this.physics.resetRack();
    this.controls = { aim: 0, position: 0, power: 0.68, spin: 0 };
    this.physics.resetBall(0);
    this.cameraResetSoon();
    this.emitSnapshot();
    this.onControls?.({ ...this.controls });
  }

  renamePlayer(index: number, name: string): void {
    const player = this.session.players[index];
    if (!player || !name || player.name === name) return;
    player.name = name;
    this.emitSnapshot();
  }

  setReducedEffects(enabled: boolean): void {
    this.reducedEffects = enabled;
    this.renderer.setReducedEffects(enabled);
  }

  setQualityMode(mode: QualityMode): void {
    this.renderer.setQualityMode(mode);
  }

  setCameraMode(mode: CameraMode): void {
    this.renderer.setCameraMode(mode);
  }

  dispose(): void {
    cancelAnimationFrame(this.animation);
    this.renderer.dispose();
    this.physics.dispose();
  }

  private readonly frame = (time: number): void => {
    const delta = Math.min(0.1, (time - this.previousTime) / 1000);
    this.previousTime = time;
    this.accumulator += delta;
    while (this.accumulator >= FIXED_TIMESTEP) {
      this.physics.step();
      this.accumulator -= FIXED_TIMESTEP;
    }

    if ((this.session.phase === 'ROLLING' || this.session.phase === 'SETTLING')
      && !this.gutterPlayed && Math.abs(this.physics.ballLateral) > LANE_HALF_WIDTH + 0.08
      && this.physics.ballProgress < -1) {
      this.gutterPlayed = true;
      this.audio.gutter();
    }
    if ((this.session.phase === 'ROLLING' || this.session.phase === 'SETTLING')
      && !this.impactPlayed && Math.abs(this.physics.ballLateral) < LANE_HALF_WIDTH
      && this.physics.ballProgress < -20.55) {
      this.impactPlayed = true;
      this.audio.impact(this.controls.power);
      this.renderer.impact(0.55 + this.controls.power * 0.45);
      window.setTimeout(() => this.audio.pins(Math.max(1, this.physics.fallenCount)), 115);
    }

    if (this.session.phase === 'ROLLING' && (this.physics.ballProgress < -18.5 || this.physics.rollElapsed > 3.1)) {
      this.session.markSettling();
      this.emitSnapshot();
    }
    if ((this.session.phase === 'ROLLING' || this.session.phase === 'SETTLING')
      && !this.scoringLocked && (this.physics.isSettled || this.physics.rollElapsed > 8.5)) {
      this.resolveRoll(time);
    }
    if (this.session.phase === 'TURN_TRANSITION' && this.transitionAt && time >= this.transitionAt) {
      this.transitionAt = 0;
      this.session.finishTransition();
      this.emitSnapshot();
    }

    this.renderer.update(this.session.phase, this.controls.aim, this.controls.position);
    this.animation = requestAnimationFrame(this.frame);
  };

  private resolveRoll(time: number): void {
    this.scoringLocked = true;
    const fallen = this.physics.fallenCount;
    const resolution = this.session.recordRoll(fallen);
    if (resolution.label === 'STRIKE!' || resolution.label === 'SPARE!') {
      this.audio.cheer();
      this.renderer.celebrate();
    }
    if (resolution.rack === 'reset') this.physics.resetRack();
    else this.physics.removeFallenPins();
    this.physics.resetBall(this.controls.position);
    if (!resolution.gameOver) this.transitionAt = time + (this.reducedEffects ? 450 : 1_250);
    this.emitSnapshot();
  }

  private setRawControls(input: ThrowInput): void {
    this.controls = {
      aim: Math.max(-1, Math.min(1, input.aim)),
      position: Math.max(-1, Math.min(1, input.position)),
      power: Math.max(0.2, Math.min(1, input.power)),
      spin: Math.max(-1, Math.min(1, input.spin)),
    };
    this.onControls?.({ ...this.controls });
  }

  private emitSnapshot(): void {
    const snapshot = this.session.snapshot();
    const color = snapshot.players[snapshot.activePlayer]?.color;
    if (color) this.renderer.setBallColor(color);
    this.onSnapshot?.(snapshot);
  }

  private cameraResetSoon(): void {
    this.previousTime = performance.now();
    this.accumulator = 0;
  }
}
