import { Money } from './money';

describe('Money', () => {
  it('constructs from major GHS units into minor (pesewas)', () => {
    expect(Money.fromMajor(350).minor).toBe(35000n);
  });

  it('constructs from minor units', () => {
    expect(Money.fromMinor(35000n).minor).toBe(35000n);
  });

  it('adds and multiplies without floats', () => {
    const unit = Money.fromMajor(345);
    expect(unit.times(8).minor).toBe(276000n);
    expect(unit.plus(Money.fromMajor(5)).minor).toBe(35000n);
  });

  it('takes basis-point fractions (commission) with floor rounding', () => {
    // 1.5% of GHS 2760.00 = GHS 41.40 -> 4140 pesewas
    expect(Money.fromMinor(276000n).bps(150).minor).toBe(4140n);
  });

  it('serializes minor units to string and formats major', () => {
    const m = Money.fromMinor(401880n);
    expect(m.toMinorString()).toBe('401880');
    expect(m.toMajorString()).toBe('4018.80');
  });
});
