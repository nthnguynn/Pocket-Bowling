import RAPIER from '@dimforge/rapier3d-compat';
import { launchVelocity } from './physicsMath';

export const FIXED_TIMESTEP = 1 / 120;
export const BALL_RADIUS = 0.36;
export const LANE_HALF_WIDTH = 2.58;

export interface BodyPose {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
}

interface PinBody {
  id: number;
  body: RAPIER.RigidBody;
}

export interface LaunchConfig {
  position: number;
  aim: number;
  power: number;
  spin: number;
}

export class PhysicsLane {
  readonly world: RAPIER.World;
  private ball: RAPIER.RigidBody;
  private pins: PinBody[] = [];
  private currentSpin = 0;
  private launched = false;
  private settleDuration = 0;
  private elapsed = 0;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_TIMESTEP;
    this.createLaneColliders();
    this.ball = this.createBall();
    this.resetRack();
  }

  setAimPosition(normalized: number): void {
    if (this.launched) return;
    const x = Math.max(-1, Math.min(1, normalized)) * 1.72;
    this.ball.setTranslation({ x, y: BALL_RADIUS + 0.02, z: 1.8 }, false);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.ball.sleep();
  }

  launch(config: LaunchConfig): void {
    const velocity = launchVelocity(config);
    this.currentSpin = Math.max(-1, Math.min(1, config.spin));
    this.elapsed = 0;
    this.settleDuration = 0;
    this.launched = true;
    this.ball.wakeUp();
    this.ball.setLinvel(velocity, true);
    this.ball.setAngvel({ x: velocity.z / BALL_RADIUS, y: this.currentSpin * 7.5, z: -velocity.x / BALL_RADIUS }, true);
  }

  step(): void {
    if (this.launched) {
      this.elapsed += FIXED_TIMESTEP;
      const ballPosition = this.ball.translation();
      if (ballPosition.z > -21 && ballPosition.y > -0.2 && Math.abs(this.currentSpin) > 0.01) {
        // A small, deterministic arcade hook. Rapier still resolves all contacts.
        const hookStrength = 3.1 * this.currentSpin * Math.min(1, this.elapsed / 1.4);
        this.ball.addForce({ x: hookStrength, y: 0, z: 0 }, true);
      }
      if (ballPosition.z < -27 || ballPosition.y < -2) {
        this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.ball.sleep();
      }
    }

    this.world.step();
    this.updateSettledDuration();
  }

  get ballPose(): BodyPose {
    return this.poseOf(this.ball);
  }

  get pinPoses(): Array<{ id: number; pose: BodyPose; fallen: boolean }> {
    return this.pins.map(({ id, body }) => ({ id, pose: this.poseOf(body), fallen: this.isPinFallen(body) }));
  }

  get ballProgress(): number {
    return this.ball.translation().z;
  }

  get ballLateral(): number {
    return this.ball.translation().x;
  }

  get rollElapsed(): number {
    return this.elapsed;
  }

  get isSettled(): boolean {
    return this.settleDuration >= 0.9;
  }

  get fallenCount(): number {
    return this.pins.reduce((count, { body }) => count + (this.isPinFallen(body) ? 1 : 0), 0);
  }

  resetBall(position = 0): void {
    this.launched = false;
    this.currentSpin = 0;
    this.elapsed = 0;
    this.settleDuration = 0;
    this.ball.setTranslation({ x: position * 1.72, y: BALL_RADIUS + 0.02, z: 1.8 }, false);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.ball.sleep();
  }

  removeFallenPins(): number {
    const fallen = this.pins.filter(({ body }) => this.isPinFallen(body));
    fallen.forEach(({ body }) => this.world.removeRigidBody(body));
    const fallenIds = new Set(fallen.map(({ id }) => id));
    this.pins = this.pins.filter(({ id }) => !fallenIds.has(id));
    return fallen.length;
  }

  resetRack(): void {
    this.pins.forEach(({ body }) => this.world.removeRigidBody(body));
    this.pins = [];
    // Regulation-inspired spacing at our visual scale. A wider rack prevents
    // a centered ball from sweeping several pins at once like an oversized puck.
    const rowSpacing = 0.96;
    let id = 0;
    for (let row = 0; row < 4; row += 1) {
      const z = -21.35 - row * 0.84;
      for (let column = 0; column <= row; column += 1) {
        const x = (column - row / 2) * rowSpacing;
        this.pins.push({ id, body: this.createPin(x, z) });
        id += 1;
      }
    }
  }

  dispose(): void {
    this.world.free();
  }

  private createLaneColliders(): void {
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(LANE_HALF_WIDTH, 0.08, 17.4)
        .setTranslation(0, -0.08, -8.2)
        .setFriction(0.34)
        .setRestitution(0.08),
      fixed,
    );
    // Lower gutter troughs keep a gutter ball away from the deck.
    for (const side of [-1, 1]) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.43, 0.08, 17.4)
          .setTranslation(side * 3.04, -0.42, -8.2)
          .setFriction(0.28),
        fixed,
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.08, 0.42, 17.4)
          .setTranslation(side * 3.5, -0.05, -8.2)
          .setFriction(0.2),
        fixed,
      );
    }
    // A low pit floor behind the pins catches bodies without bouncing them at the rack.
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(3.5, 0.08, 1.5).setTranslation(0, -0.5, -26.2).setFriction(0.55),
      fixed,
    );
  }

  private createBall(): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, BALL_RADIUS + 0.02, 1.8)
        .setLinearDamping(0.08)
        .setAngularDamping(0.06)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS).setDensity(25).setFriction(0.52).setRestitution(0.14),
      body,
    );
    body.sleep();
    return body;
  }

  private createPin(x: number, z: number): RAPIER.RigidBody {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.62, z)
        .setLinearDamping(0.18)
        .setAngularDamping(0.28)
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.38, 0.205)
        .setDensity(7.5)
        .setFriction(0.58)
        .setRestitution(0.18),
      body,
    );
    return body;
  }

  private poseOf(body: RAPIER.RigidBody): BodyPose {
    const p = body.translation();
    const r = body.rotation();
    return {
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    };
  }

  private isPinFallen(body: RAPIER.RigidBody): boolean {
    const rotation = body.rotation();
    const upY = 1 - 2 * (rotation.x * rotation.x + rotation.z * rotation.z);
    const position = body.translation();
    return upY < 0.66 || position.y < 0.32 || Math.abs(position.x) > 2.75 || position.z < -25.7;
  }

  private updateSettledDuration(): void {
    if (!this.launched) {
      this.settleDuration = 0;
      return;
    }
    const ballSpeed = this.ball.linvel();
    const ballIsDone = this.ball.isSleeping()
      || this.ball.translation().z < -26
      || Math.hypot(ballSpeed.x, ballSpeed.y, ballSpeed.z) < 0.16;
    const pinsAreCalm = this.pins.every(({ body }) => {
      const linear = body.linvel();
      const angular = body.angvel();
      return body.isSleeping()
        || (Math.hypot(linear.x, linear.y, linear.z) < 0.24
          && Math.hypot(angular.x, angular.y, angular.z) < 0.35);
    });
    this.settleDuration = ballIsDone && pinsAreCalm ? this.settleDuration + FIXED_TIMESTEP : 0;
  }
}
