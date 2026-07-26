import { describe, expect, it } from 'vitest';
import {
  BROWN_SWITCH_PRESS_DURATION_SECONDS,
  BROWN_SWITCH_SHOULDER_END,
  BROWN_SWITCH_SHOULDER_END_SECONDS,
  BROWN_SWITCH_SHOULDER_START,
  BROWN_SWITCH_SHOULDER_START_SECONDS,
  sampleBrownSwitchPress,
} from './keyswitch-motion';

describe('Brown-style keyswitch actuation curve', () => {
  it('takes up travel, dwells on an upper shoulder, then breaks through', () => {
    expect(sampleBrownSwitchPress(0)).toBe(0);
    expect(
      sampleBrownSwitchPress(BROWN_SWITCH_SHOULDER_START_SECONDS)
    ).toBeCloseTo(BROWN_SWITCH_SHOULDER_START);

    const shoulderMiddle = sampleBrownSwitchPress(
      (BROWN_SWITCH_SHOULDER_START_SECONDS +
        BROWN_SWITCH_SHOULDER_END_SECONDS) /
        2
    );
    expect(shoulderMiddle).toBeGreaterThan(BROWN_SWITCH_SHOULDER_START);
    expect(shoulderMiddle).toBeLessThan(BROWN_SWITCH_SHOULDER_END);
    expect(
      sampleBrownSwitchPress(BROWN_SWITCH_SHOULDER_END_SECONDS)
    ).toBeCloseTo(BROWN_SWITCH_SHOULDER_END);

    const afterBreak = sampleBrownSwitchPress(
      (BROWN_SWITCH_SHOULDER_END_SECONDS +
        BROWN_SWITCH_PRESS_DURATION_SECONDS) /
        2
    );
    expect(afterBreak).toBeGreaterThan(BROWN_SWITCH_SHOULDER_END);
    expect(afterBreak).toBeLessThan(1);
    expect(sampleBrownSwitchPress(BROWN_SWITCH_PRESS_DURATION_SECONDS)).toBe(1);
  });

  it('clamps before and after the physical stroke', () => {
    expect(sampleBrownSwitchPress(-1)).toBe(0);
    expect(sampleBrownSwitchPress(10)).toBe(1);
  });
});
