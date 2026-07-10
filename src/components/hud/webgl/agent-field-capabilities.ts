export interface SpatialCapabilitySignals {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  saveData?: boolean;
}

/** Conservative one-shot hint; never infer performance from a demand-loop FPS sample. */
export function isLowPowerSpatialDevice({
  hardwareConcurrency,
  deviceMemory,
  saveData,
}: SpatialCapabilitySignals): boolean {
  return (
    saveData === true ||
    (hardwareConcurrency !== undefined && hardwareConcurrency <= 4) ||
    (deviceMemory !== undefined && deviceMemory <= 4)
  );
}
