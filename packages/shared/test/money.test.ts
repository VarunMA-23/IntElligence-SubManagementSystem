import { describe, it, expect } from "vitest";
import { dec, money, toMinorUnits, fromMinorUnits, sum, maxZero, percentageOf, formatMoney } from "../src/money.js";
import Decimal from "decimal.js";

describe("dec", () => {
  it("converts a number", () => {
    expect(dec(1.5).toString()).toBe("1.5");
  });

  it("converts a string", () => {
    expect(dec("99.99").toString()).toBe("99.99");
  });

  it("returns the same Decimal if already a Decimal", () => {
    const d = new Decimal(3.14);
    expect(dec(d)).toBe(d);
  });

  it("converts an object with toString()", () => {
    const obj = { toString: () => "7.77" };
    expect(dec(obj).toString()).toBe("7.77");
  });
});

describe("money", () => {
  it("strips trailing zeros", () => {
    expect(money("10.0000")).toBe("10");
    expect(money("9.5000")).toBe("9.5");
    expect(money("9.5500")).toBe("9.55");
  });

  it("handles zero", () => {
    expect(money(0)).toBe("0");
  });
});

describe("toMinorUnits", () => {
  it("converts dollars to cents", () => {
    expect(toMinorUnits("9.99")).toBe(999);
    expect(toMinorUnits("100")).toBe(10000);
  });

  it("rounds half-up", () => {
    expect(toMinorUnits("1.005")).toBe(101);
    expect(toMinorUnits("1.004")).toBe(100);
  });
});

describe("fromMinorUnits", () => {
  it("converts cents to dollars", () => {
    expect(fromMinorUnits(999)).toBe("9.99");
    expect(fromMinorUnits(10000)).toBe("100.00");
  });
});

describe("sum", () => {
  it("sums an array of values", () => {
    expect(sum(["1.5", "2.5", "3"]).toString()).toBe("7");
  });

  it("returns 0 for empty array", () => {
    expect(sum([]).toString()).toBe("0");
  });
});

describe("maxZero", () => {
  it("returns the value if positive", () => {
    expect(maxZero("5").toString()).toBe("5");
  });

  it("returns 0 for negative values", () => {
    expect(maxZero("-3").toString()).toBe("0");
  });

  it("returns 0 for zero", () => {
    expect(maxZero(0).toString()).toBe("0");
  });
});

describe("percentageOf", () => {
  it("calculates percentage correctly", () => {
    expect(percentageOf("100", "20").toString()).toBe("20");
    expect(percentageOf("50", "10").toString()).toBe("5");
  });

  it("handles fractional percentages", () => {
    expect(percentageOf("200", "7.5").toString()).toBe("15");
  });
});

describe("formatMoney", () => {
  it("formats USD with dollar sign", () => {
    const result = formatMoney("99.99", "USD");
    expect(result).toContain("99.99");
    expect(result).toContain("$");
  });

  it("falls back gracefully for unknown currency", () => {
    const result = formatMoney("50", "XYZ");
    expect(result).toContain("50");
  });
});
