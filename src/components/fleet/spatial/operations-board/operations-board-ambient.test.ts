import { describe, expect, it, vi } from 'vitest';
import {
  AMBIENT_FRAME_DELTA_CAP_S,
  ECONOMY_AMBIENT_FRAME_MS,
  createAmbientFrameScheduler,
  resolveAmbientCadence,
} from './operations-board-ambient';

const seen = {
  reduced: false,
  visible: true,
  lowPower: false,
  onBattery: false,
};

describe('ambient cadence', () => {
  it('paints at the display refresh when nothing constrains it', () => {
    expect(resolveAmbientCadence(seen)).toBe('display');
  });

  it('slows to economy on battery and on weak hardware, never parks for power', () => {
    expect(resolveAmbientCadence({ ...seen, onBattery: true })).toBe('economy');
    expect(resolveAmbientCadence({ ...seen, lowPower: true })).toBe('economy');
    expect(
      resolveAmbientCadence({ ...seen, lowPower: true, onBattery: true })
    ).toBe('economy');
  });

  it('parks only for the operator preference or an unseen board', () => {
    expect(resolveAmbientCadence({ ...seen, reduced: true })).toBe('parked');
    expect(resolveAmbientCadence({ ...seen, visible: false })).toBe('parked');
    expect(
      resolveAmbientCadence({ ...seen, reduced: true, onBattery: true })
    ).toBe('parked');
  });

  it('lets a rotor consume an economy frame whole', () => {
    // An economy frame is the timer plus one display refresh; a clamp below
    // that would make the rotor turn slower on battery than on AC.
    expect(AMBIENT_FRAME_DELTA_CAP_S).toBeGreaterThan(
      (ECONOMY_AMBIENT_FRAME_MS + 1000 / 60) / 1000
    );
  });
});

describe('ambient frame scheduler', () => {
  function harness() {
    const timers = new Map<number, () => void>();
    let next = 1;
    const scheduler = createAmbientFrameScheduler(
      callback => {
        const handle = next++;
        timers.set(handle, callback);
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      handle => {
        timers.delete(handle as unknown as number);
      }
    );
    const fire = () => {
      for (const [handle, callback] of [...timers]) {
        timers.delete(handle);
        callback();
      }
    };
    return { scheduler, timers, fire };
  }

  it('paints immediately under the display cadence', () => {
    const { scheduler, timers } = harness();
    const invalidate = vi.fn();
    scheduler.request('display', invalidate);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(timers.size).toBe(0);
  });

  it('coalesces every economy request into one deferred paint', () => {
    const { scheduler, timers, fire } = harness();
    const rotors = vi.fn();
    const ring = vi.fn();
    scheduler.request('economy', rotors);
    scheduler.request('economy', ring);
    scheduler.request('economy', rotors);
    expect(rotors).not.toHaveBeenCalled();
    expect(timers.size).toBe(1);
    fire();
    // One paint per interval however many animations asked.
    expect(rotors).toHaveBeenCalledOnce();
    expect(ring).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  it('requests nothing while parked', () => {
    const { scheduler, timers } = harness();
    const invalidate = vi.fn();
    scheduler.request('parked', invalidate);
    expect(invalidate).not.toHaveBeenCalled();
    expect(timers.size).toBe(0);
  });

  it('drops a pending economy frame on dispose', () => {
    const { scheduler, timers, fire } = harness();
    const invalidate = vi.fn();
    scheduler.request('economy', invalidate);
    scheduler.dispose();
    expect(timers.size).toBe(0);
    fire();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
