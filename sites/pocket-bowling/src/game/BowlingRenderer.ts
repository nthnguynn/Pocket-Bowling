import * as THREE from 'three';
import { BALL_RADIUS, LANE_HALF_WIDTH, PhysicsLane } from './PhysicsLane';
import type { ThemeMode } from '../ui/theme';

export type QualityMode = 'auto' | 'high' | 'low';
export type CameraMode = 'dynamic' | 'chase' | 'side' | 'pins' | 'top';

export class BowlingRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(47, 1, 0.1, 100);
  private readonly ball = new THREE.Group();
  private ballMaterial!: THREE.MeshPhysicalMaterial;
  private ballColor = '#ff5caf';
  private readonly ballTextures = new Map<string, THREE.CanvasTexture>();
  private readonly pinMeshes = new Map<number, THREE.Group>();
  private readonly aimGuide = new THREE.Group();
  private reducedEffects = false;
  private frameGlow = 0;
  private cameraShake = 0;
  private qualityMode: QualityMode = 'auto';
  private cameraMode: CameraMode = 'dynamic';
  private qualityWindowStarted = performance.now();
  private qualityFrames = 0;
  private currentPixelRatio = 1;
  private themeExposure = 1.18;
  private readonly clock = new THREE.Clock();

  constructor(private readonly container: HTMLElement, private readonly physics: PhysicsLane) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.currentPixelRatio = this.initialAutoPixelRatio();
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.domElement.className = 'game-canvas';
    container.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x130814);
    this.scene.fog = new THREE.FogExp2(0x130814, 0.018);
    this.camera.position.set(0, 7.6, 15.2);
    this.camera.lookAt(0, 0.25, -9.5);

    this.buildEnvironment();
    this.buildBall();
    this.buildPins();
    this.buildAimGuide();
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  update(phase: string, aim: number, position: number): void {
    const ballPose = this.physics.ballPose;
    this.ball.position.set(ballPose.position.x, ballPose.position.y, ballPose.position.z);
    this.ball.quaternion.set(ballPose.rotation.x, ballPose.rotation.y, ballPose.rotation.z, ballPose.rotation.w);

    const livePins = new Set<number>();
    this.physics.pinPoses.forEach(({ id, pose }) => {
      livePins.add(id);
      let mesh = this.pinMeshes.get(id);
      if (!mesh) {
        mesh = this.createPinMesh();
        this.pinMeshes.set(id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
      mesh.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
    });
    this.pinMeshes.forEach((mesh, id) => {
      if (!livePins.has(id)) {
        this.scene.remove(mesh);
        this.pinMeshes.delete(id);
      }
    });

    const isAiming = phase === 'AIMING' || phase === 'READY';
    this.aimGuide.visible = isAiming;
    this.aimGuide.position.x = position * 1.72;
    this.aimGuide.rotation.y = -aim * 0.11;

    const targetCamera = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    const targetUp = new THREE.Vector3(0, 1, 0);
    let targetFov = 47;
    if (this.cameraMode === 'chase') {
      targetCamera.set(
        ballPose.position.x * 0.84,
        2.55,
        THREE.MathUtils.clamp(ballPose.position.z + 5.3, -17.3, 14),
      );
      targetLook.set(ballPose.position.x * 0.72, 0.25, ballPose.position.z - 5.8);
      targetFov = 53;
    } else if (this.cameraMode === 'side') {
      targetCamera.set(
        4.25,
        3.9,
        THREE.MathUtils.clamp(ballPose.position.z + 2.7, -17.5, 7.5),
      );
      targetLook.set(ballPose.position.x * 0.4, 0.35, ballPose.position.z - 1.8);
      targetFov = 56;
    } else if (this.cameraMode === 'pins') {
      targetCamera.set(0, 1.35, -26.65);
      targetLook.set(
        ballPose.position.x * 0.45,
        0.35,
        THREE.MathUtils.clamp(ballPose.position.z, -21.2, 4),
      );
      targetFov = 60;
    } else if (this.cameraMode === 'top') {
      targetCamera.set(0, 40, -10.5);
      targetLook.set(0, 0, -10.5);
      targetUp.set(0, 0, -1);
      targetFov = 56;
    } else {
      targetCamera.set(0, 7.6, 15.2);
      targetLook.set(0, 0.25, -9.5);
      if (!isAiming) {
        const followZ = THREE.MathUtils.clamp(ballPose.position.z + 10.5, -8, 13.5);
        targetCamera.set(ballPose.position.x * 0.22, 6.4, followZ);
        targetLook.set(ballPose.position.x * 0.18, 0.3, Math.min(ballPose.position.z - 7, -9));
      }
    }
    const frameDelta = Math.min(0.25, this.clock.getDelta());
    const smoothing = 1 - Math.exp(-frameDelta * (this.reducedEffects ? 3.4 : 6.2));
    this.camera.position.lerp(targetCamera, smoothing);
    this.camera.up.lerp(targetUp, smoothing).normalize();
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, smoothing);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    const currentDirection = new THREE.Vector3();
    this.camera.getWorldDirection(currentDirection);
    const currentLook = this.camera.position.clone().add(currentDirection.multiplyScalar(12));
    currentLook.lerp(targetLook, smoothing);
    const delta = Math.min(0.05, frameDelta);
    if (this.cameraShake > 0 && !this.reducedEffects) {
      this.cameraShake = Math.max(0, this.cameraShake - delta * 1.7);
      const pulse = this.cameraShake * this.cameraShake;
      this.camera.position.x += Math.sin(performance.now() * 0.08) * pulse;
      this.camera.position.y += Math.cos(performance.now() * 0.067) * pulse * 0.45;
    }
    this.camera.lookAt(currentLook);

    if (this.frameGlow > 0) {
      this.frameGlow = Math.max(0, this.frameGlow - delta);
      const strength = Math.sin(this.frameGlow * 16) * 0.12 + 1;
      this.renderer.toneMappingExposure = this.themeExposure * strength;
    } else {
      this.renderer.toneMappingExposure = this.themeExposure;
    }
    this.renderer.render(this.scene, this.camera);
    this.adaptQuality();
  }

  celebrate(): void {
    if (!this.reducedEffects) this.frameGlow = 1.2;
  }

  impact(intensity = 1): void {
    if (!this.reducedEffects) this.cameraShake = Math.max(this.cameraShake, 0.38 * intensity);
  }

  setReducedEffects(enabled: boolean): void {
    this.reducedEffects = enabled;
  }

  setQualityMode(mode: QualityMode): void {
    this.qualityMode = mode;
    this.currentPixelRatio = mode === 'low'
      ? 1
      : mode === 'high' ? Math.min(window.devicePixelRatio, 2) : this.initialAutoPixelRatio();
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.shadowMap.enabled = mode !== 'low';
    this.qualityFrames = 0;
    this.qualityWindowStarted = performance.now();
    this.resize();
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  /** Mỗi người chơi có bóng cùng màu với chấm màu trên bảng điểm. */
  setBallColor(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color) || color === this.ballColor) return;
    this.ballColor = color;
    let texture = this.ballTextures.get(color);
    if (!texture) {
      texture = this.makeMarbleTexture(color);
      this.ballTextures.set(color, texture);
    }
    this.ballMaterial.map = texture;
    this.ballMaterial.needsUpdate = true;
  }

  setTheme(theme: ThemeMode): void {
    const light = theme === 'light';
    const background = light ? 0xf4ddea : 0x130814;
    this.scene.background = new THREE.Color(background);
    this.scene.fog = new THREE.FogExp2(background, light ? 0.012 : 0.018);
    this.themeExposure = light ? 1.32 : 1.18;
    this.renderer.toneMappingExposure = this.themeExposure;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.ballTextures.forEach((texture) => texture.dispose());
    this.renderer.dispose();
    this.container.replaceChildren();
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private initialAutoPixelRatio(): number {
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (memory <= 4) return 1;
    return Math.min(window.devicePixelRatio, 1.6);
  }

  private adaptQuality(): void {
    if (this.qualityMode !== 'auto' || document.visibilityState !== 'visible') return;
    this.qualityFrames += 1;
    const now = performance.now();
    const elapsed = now - this.qualityWindowStarted;
    if (elapsed < 3_000) return;
    const fps = this.qualityFrames / (elapsed / 1_000);
    const ceiling = Math.min(window.devicePixelRatio, 1.75);
    let next = this.currentPixelRatio;
    if (fps < 46 && next > 1) next = Math.max(1, next - 0.2);
    else if (fps > 57 && next < ceiling) next = Math.min(ceiling, next + 0.15);
    if (Math.abs(next - this.currentPixelRatio) >= 0.1) {
      this.currentPixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.renderer.shadowMap.enabled = next >= 1.15;
      this.resize();
    }
    this.qualityFrames = 0;
    this.qualityWindowStarted = now;
  }

  private buildEnvironment(): void {
    const wood = this.makeWoodTexture();
    const laneMaterial = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.34, metalness: 0.02 });
    const lane = new THREE.Mesh(new THREE.BoxGeometry(LANE_HALF_WIDTH * 2, 0.12, 34.8), laneMaterial);
    lane.position.set(0, -0.08, -8.2);
    lane.receiveShadow = true;
    this.scene.add(lane);

    const approach = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.14, 10),
      new THREE.MeshStandardMaterial({ color: 0xb9824f, roughness: 0.52 }),
    );
    approach.position.set(0, -0.1, 13.9);
    approach.receiveShadow = true;
    this.scene.add(approach);

    const foul = new THREE.Mesh(
      new THREE.BoxGeometry(7.1, 0.025, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x17202c, roughness: 0.3 }),
    );
    foul.position.set(0, 0.01, 8.85);
    this.scene.add(foul);

    const gutterMaterial = new THREE.MeshStandardMaterial({ color: 0x2a172c, roughness: 0.22, metalness: 0.48 });
    for (const side of [-1, 1]) {
      const gutter = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.1, 34.8), gutterMaterial);
      gutter.position.set(side * 3.04, -0.41, -8.2);
      gutter.receiveShadow = true;
      this.scene.add(gutter);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 34.8), gutterMaterial);
      rail.position.set(side * 3.5, -0.12, -8.2);
      this.scene.add(rail);
    }

    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.15, 4.5),
      new THREE.MeshStandardMaterial({ color: 0x8e6846, roughness: 0.6 }),
    );
    deck.position.set(0, -0.12, -23.2);
    deck.receiveShadow = true;
    this.scene.add(deck);

    // Lane dots and arrows are real geometry slightly above the wood.
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0x75405c, transparent: true, opacity: 0.78 });
    [-1.7, -0.85, 0, 0.85, 1.7].forEach((x) => {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.075, 18), markerMaterial);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(x, 0.012, 5.0);
      this.scene.add(dot);
    });
    [-1.7, -0.85, 0, 0.85, 1.7].forEach((x) => {
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.48, 3), markerMaterial);
      arrow.rotation.x = -Math.PI / 2;
      arrow.rotation.z = Math.PI;
      arrow.position.set(x, 0.018, -2.2);
      arrow.scale.z = 0.05;
      this.scene.add(arrow);
    });

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x1e0d20, roughness: 0.62 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(16, 7.5, 0.35), wallMaterial);
    backWall.position.set(0, 3.4, -27.8);
    this.scene.add(backWall);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.32, 6.5, 38), wallMaterial);
      wall.position.set(side * 5.2, 3, -8.5);
      this.scene.add(wall);
    }

    const accent = new THREE.Mesh(
      new THREE.BoxGeometry(9.5, 0.06, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xff58ad }),
    );
    accent.position.set(0, 4.4, -27.55);
    this.scene.add(accent);

    this.scene.add(new THREE.HemisphereLight(0xffb6dc, 0x261126, 1.35));
    const key = new THREE.DirectionalLight(0xfff2d7, 4.3);
    key.position.set(-4, 10, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -30;
    this.scene.add(key);
    const pinLight = new THREE.SpotLight(0xff91c8, 30, 24, Math.PI / 4.5, 0.48, 1.3);
    pinLight.position.set(0, 7, -17);
    pinLight.target.position.set(0, 0, -23);
    this.scene.add(pinLight, pinLight.target);
  }

  private buildBall(): void {
    const texture = this.makeMarbleTexture(this.ballColor);
    this.ballTextures.set(this.ballColor, texture);
    this.ballMaterial = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.16,
      metalness: 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 48, 32), this.ballMaterial);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    this.ball.add(sphere);
    const holeMaterial = new THREE.MeshStandardMaterial({ color: 0x030508, roughness: 0.8 });
    const holeGeometry = new THREE.SphereGeometry(0.058, 16, 12);
    const holePositions: Array<[number, number, number]> = [
      [-0.08, 0.18, 0.31], [0.08, 0.18, 0.31], [0, 0.055, 0.35],
    ];
    holePositions.forEach(([x, y, z]) => {
      const hole = new THREE.Mesh(holeGeometry, holeMaterial);
      hole.position.set(x, y, z);
      hole.scale.z = 0.35;
      this.ball.add(hole);
    });
    this.scene.add(this.ball);
  }

  private buildPins(): void {
    this.physics.pinPoses.forEach(({ id }) => {
      const mesh = this.createPinMesh();
      this.pinMeshes.set(id, mesh);
      this.scene.add(mesh);
    });
  }

  private createPinMesh(): THREE.Group {
    const group = new THREE.Group();
    const profile = [
      [0.14, -0.6], [0.22, -0.55], [0.25, -0.38], [0.23, -0.15],
      [0.15, 0.05], [0.13, 0.2], [0.2, 0.38], [0.16, 0.52], [0.07, 0.6],
    ].map(([x, y]) => new THREE.Vector2(x!, y!));
    const body = new THREE.Mesh(
      new THREE.LatheGeometry(profile, 32),
      new THREE.MeshPhysicalMaterial({ color: 0xf5f3ec, roughness: 0.26, clearcoat: 0.55 }),
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xd82e47, roughness: 0.34 });
    for (const y of [0.23, 0.31]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.148, 0.026, 8, 32), ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      group.add(ring);
    }
    return group;
  }

  private buildAimGuide(): void {
    const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xff78bd, transparent: true, opacity: 0.68 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.01, 15), lineMaterial);
    beam.position.set(0, 0.035, -7.5);
    this.aimGuide.add(beam);
    const target = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.24, 28), lineMaterial);
    target.rotation.x = -Math.PI / 2;
    target.position.set(0, 0.04, -14.8);
    this.aimGuide.add(target);
    this.scene.add(this.aimGuide);
  }

  private makeWoodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c8935e';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let x = 0; x < canvas.width; x += 32) {
      context.fillStyle = x % 64 === 0 ? '#d7a873' : '#bd8350';
      context.fillRect(x, 0, 29, canvas.height);
      context.fillStyle = 'rgba(72,43,25,.2)';
      context.fillRect(x + 29, 0, 2, canvas.height);
      for (let y = (x * 13) % 80; y < canvas.height; y += 95) {
        context.fillStyle = 'rgba(91,48,24,.12)';
        context.fillRect(x + 4, y, 21, 2);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.2, 5.5);
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  private makeMarbleTexture(base: string): THREE.CanvasTexture {
    // Dải màu suy ra từ màu gốc theo HSL (sRGB), giữ đúng tỉ lệ sáng/tối của bóng hồng ban đầu.
    const [h, s] = hexToHsl(base);
    const hsl = (hue: number, saturation: number, lightness: number) =>
      `hsl(${((hue % 360) + 360) % 360} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(160, 120, 20, 256, 256, 360);
    gradient.addColorStop(0, hsl(h, s, 0.92));
    gradient.addColorStop(0.34, base);
    gradient.addColorStop(0.7, hsl(h - 23, s * 0.57, 0.39));
    gradient.addColorStop(1, hsl(h - 37, 0.64, 0.12));
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
    context.globalAlpha = 0.32;
    for (let i = -120; i < 700; i += 34) {
      context.strokeStyle = i % 68 === 0 ? hsl(h, s, 0.97) : hsl(h, s, 0.8);
      context.lineWidth = 11;
      context.beginPath();
      context.moveTo(i, 0);
      context.bezierCurveTo(i + 140, 130, i - 90, 320, i + 110, 512);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }
}

function hexToHsl(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (!delta) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
}
