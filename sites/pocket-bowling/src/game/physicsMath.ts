export interface LaunchVectorInput {
  power: number;
  aim: number;
}

export function launchVelocity(config: LaunchVectorInput): { x: number; y: number; z: number } {
  const power = Math.max(0.2, Math.min(1, config.power));
  const angle = Math.max(-1, Math.min(1, config.aim)) * 0.11;
  // 7–11 m/s over the useful range: approachable, but a centered medium ball
  // does not carry unlimited energy through the whole rack.
  const speed = 6 + power * 5;
  return {
    x: Math.sin(angle) * speed,
    y: 0,
    z: -Math.cos(angle) * speed,
  };
}
