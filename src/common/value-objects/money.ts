// All money is BigInt minor units (pesewas; GHS * 100). Never Float. All money
// arithmetic in the codebase goes through this value object (spec §3.4).
export class Money {
  private constructor(readonly minor: bigint) {}

  static fromMinor(minor: bigint): Money {
    return new Money(minor);
  }

  /** major GHS (e.g. 350.5) -> minor (35050). Rounds to nearest pesewa. */
  static fromMajor(major: number): Money {
    return new Money(BigInt(Math.round(major * 100)));
  }

  plus(other: Money): Money {
    return new Money(this.minor + other.minor);
  }

  minus(other: Money): Money {
    return new Money(this.minor - other.minor);
  }

  /** Multiply by an integer count (e.g. price per bag * bags). */
  times(count: number): Money {
    if (!Number.isInteger(count)) {
      throw new Error('Money.times expects an integer count');
    }
    return new Money(this.minor * BigInt(count));
  }

  /** Take a basis-point fraction (150 bps = 1.5%), floor-rounded. */
  bps(basisPoints: number): Money {
    return new Money((this.minor * BigInt(basisPoints)) / 10000n);
  }

  toMinorString(): string {
    return this.minor.toString();
  }

  toMajorString(): string {
    const neg = this.minor < 0n;
    const abs = neg ? -this.minor : this.minor;
    const whole = abs / 100n;
    const frac = (abs % 100n).toString().padStart(2, '0');
    return `${neg ? '-' : ''}${whole}.${frac}`;
  }
}
