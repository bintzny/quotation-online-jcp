import { describe, expect, it } from "vitest";
import {
  allocate, formatQuantity, parsePercent, parseQuantity, priceQuotation,
  type PricingInput, type PricingLineInput,
} from "@/server/domain/pricing";

const NONE = { type: "NONE" as const, value: 0 };
const line = (o: Partial<PricingLineInput>): PricingLineInput => ({
  quantityMilli: 1000, unitPriceSatang: 10_000, discount: NONE, minPriceSatang: null, isService: false, ...o,
});
function price(input: Partial<PricingInput> & { lines: PricingLineInput[] }) {
  const r = priceQuotation({ billDiscount: NONE, vatRateBp: 700, ...input });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.result;
}

describe("priceQuotation", () => {
  it("adds VAT 7% outside the price", () => {
    const r = price({ lines: [line({ quantityMilli: 100_000, unitPriceSatang: 8000, minPriceSatang: 8000 })] });
    expect(r.subtotalSatang).toBe(800_000); // 100 × 80.00
    expect(r.vatSatang).toBe(56_000);
    expect(r.totalSatang).toBe(856_000);
    expect(r.requiresApproval).toBe(false);
  });

  it("flags the example from the requirements: OPP tape below 80 baht needs approval", () => {
    const r = price({ lines: [line({ quantityMilli: 100_000, unitPriceSatang: 7500, minPriceSatang: 8000 })] });
    expect(r.lines[0].approvalReason).toBe("belowMin");
    expect(r.requiresApproval).toBe(true);
  });

  it("exactly the minimum price needs no approval", () => {
    expect(price({ lines: [line({ unitPriceSatang: 8000, minPriceSatang: 8000 })] }).requiresApproval).toBe(false);
  });

  it("line discounts count: 10% off 85.00 = 76.50 < 80.00", () => {
    const r = price({ lines: [line({ unitPriceSatang: 8500, minPriceSatang: 8000, discount: { type: "PERCENT", value: 1000 } })] });
    expect(r.lines[0].discountSatang).toBe(850);
    expect(r.lines[0].netSatang).toBe(7650);
    expect(r.lines[0].approvalReason).toBe("belowMin");
  });

  it("the bill discount is spread over lines in proportion and can trigger approval", () => {
    // two lines at the minimum: 300 and 100 baht. A 40-baht bill discount → 30 and 10.
    const r = price({
      lines: [
        line({ quantityMilli: 3000, unitPriceSatang: 10_000, minPriceSatang: 10_000 }),
        line({ quantityMilli: 1000, unitPriceSatang: 10_000, minPriceSatang: 9_000 }),
      ],
      billDiscount: { type: "AMOUNT", value: 4000 },
    });
    expect(r.lines.map((l) => l.billShareSatang)).toEqual([3000, 1000]);
    expect(r.lines[0].approvalReason).toBe("belowMin"); // 270/3 = 90 < 100
    expect(r.lines[1].approvalReason).toBeNull(); // 90 ≥ 90
    expect(r.afterDiscountSatang).toBe(36_000);
  });

  it("service items never need approval; custom lines always do; products without a minimum do", () => {
    const r = price({
      lines: [
        line({ isService: true, minPriceSatang: null, unitPriceSatang: 1 }),
        line({ isCustom: true, minPriceSatang: null }),
        line({ minPriceSatang: null }),
      ],
    });
    expect(r.lines.map((l) => l.approvalReason)).toEqual([null, "customLine", "noMinPrice"]);
  });

  it("does not evaluate approval in the browser (no minimum price given)", () => {
    const r = price({ lines: [line({ minPriceSatang: undefined, unitPriceSatang: 1 })] });
    expect(r.requiresApproval).toBe(false);
  });

  it("compares the exact net unit price for fractional quantities (no rounding loophole)", () => {
    // 3 units for 239.99 baht total = 79.9966…/unit < 80.00
    const r = price({ lines: [line({ quantityMilli: 3000, unitPriceSatang: 8000, minPriceSatang: 8000, discount: { type: "AMOUNT", value: 1 } })] });
    expect(r.lines[0].finalSatang).toBe(23_999);
    expect(r.lines[0].approvalReason).toBe("belowMin");
    // 2.5 kg at 80.00
    const r2 = price({ lines: [line({ quantityMilli: 2500, unitPriceSatang: 8000, minPriceSatang: 8000 })] });
    expect(r2.lines[0].grossSatang).toBe(20_000);
    expect(r2.requiresApproval).toBe(false);
  });

  it("rounds half-up: line amount, percentage discount and VAT", () => {
    // 0.333 × 10.05 = 3.34665 → 3.35
    const r = price({ lines: [line({ quantityMilli: 333, unitPriceSatang: 1005 })], vatRateBp: 700 });
    expect(r.lines[0].grossSatang).toBe(335);
    expect(r.vatSatang).toBe(23); // 3.35 × 7% = 0.2345 → 0.23
    const r2 = price({ lines: [line({ unitPriceSatang: 50 })], vatRateBp: 700 }); // 0.50 × 7% = 0.035 → 0.04
    expect(r2.vatSatang).toBe(4);
  });

  it("works with VAT turned off for a company", () => {
    expect(price({ lines: [line({})], vatRateBp: 0 }).totalSatang).toBe(10_000);
  });

  it("rejects discounts larger than the amount", () => {
    expect(priceQuotation({ lines: [line({ discount: { type: "AMOUNT", value: 10_001 } })], billDiscount: NONE, vatRateBp: 700 }))
      .toEqual({ ok: false, error: { code: "lineDiscountTooLarge", line: 0 } });
    expect(priceQuotation({ lines: [line({})], billDiscount: { type: "AMOUNT", value: 10_001 }, vatRateBp: 700 }))
      .toEqual({ ok: false, error: { code: "billDiscountTooLarge" } });
  });

  it("a 100% discount gives zero and still needs approval", () => {
    const r = price({ lines: [line({ minPriceSatang: 8000, discount: { type: "PERCENT", value: 10_000 } })] });
    expect(r.totalSatang).toBe(0);
    expect(r.requiresApproval).toBe(true);
  });

  it("rejects totals too large to add up safely", () => {
    const big = line({ quantityMilli: 1_000_000_000, unitPriceSatang: 1_000_000_000 });
    expect(priceQuotation({ lines: [big], billDiscount: NONE, vatRateBp: 700 }).ok).toBe(false);
  });
});

describe("allocate", () => {
  it("always adds up exactly", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocate(1, [5, 5])).toEqual([1, 0]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(7, [0, 3])).toEqual([0, 7]);
    const w = [123_456, 7_891, 1, 999_999];
    expect(allocate(54_321, w).reduce((a, b) => a + b, 0)).toBe(54_321);
  });
});

describe("parsing", () => {
  it("parses quantities up to 3 decimals", () => {
    expect(parseQuantity("100")).toBe(100_000);
    expect(parseQuantity("1.5")).toBe(1500);
    expect(parseQuantity("1,000.25")).toBe(1_000_250);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("-1")).toBeNull();
    expect(parseQuantity("1.2345")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
    expect(parseQuantity("1e3")).toBeNull();
    expect(parseQuantity("1000001")).toBeNull();
    expect(formatQuantity(1500)).toBe("1.5");
    expect(formatQuantity(1_000_000)).toBe("1,000");
    expect(formatQuantity(1250)).toBe("1.25");
  });
  it("parses percentages to basis points", () => {
    expect(parsePercent("10")).toBe(1000);
    expect(parsePercent("7.5")).toBe(750);
    expect(parsePercent("100")).toBe(10_000);
    expect(parsePercent("100.01")).toBeNull();
    expect(parsePercent("1.234")).toBeNull();
    expect(parsePercent("-5")).toBeNull();
  });
});

describe("review follow-ups", () => {
  it("percentage discounts round half-up at exactly .5 satang: 5% of 10.10 = 0.505 → 0.51", () => {
    const r = price({ lines: [line({ unitPriceSatang: 1010, discount: { type: "PERCENT", value: 500 } })] });
    expect(r.lines[0].discountSatang).toBe(51);
    expect(r.lines[0].netSatang).toBe(959);
  });

  it("a percentage bill discount whose rounding share tips one line just below its minimum", () => {
    // three equal lines of 100.00 at minimum 99.67; 1% bill discount = 3.00 → shares 1.00 each → 99.00 < 99.67
    const lines = [0, 1, 2].map(() => line({ unitPriceSatang: 10_000, minPriceSatang: 9_967 }));
    const r = price({ lines, billDiscount: { type: "PERCENT", value: 100 } });
    expect(r.billDiscountSatang).toBe(300);
    expect(r.lines.map((l) => l.billShareSatang)).toEqual([100, 100, 100]);
    expect(r.lines.every((l) => l.approvalReason === "belowMin")).toBe(true);
    // 0.01% of 300.00 = 0.03 → one satang per line; a minimum of 99.99 is then exactly met
    const r2 = price({ lines: lines.map((l) => ({ ...l, minPriceSatang: 9_999 })), billDiscount: { type: "PERCENT", value: 1 } });
    expect(r2.lines.map((l) => l.billShareSatang)).toEqual([1, 1, 1]);
    expect(r2.requiresApproval).toBe(false);
    // 2 satang over 3 lines: the first two lines carry them; the third stays at 100.00
    const r3 = price({ lines: lines.map((l) => ({ ...l, minPriceSatang: 10_000 })), billDiscount: { type: "AMOUNT", value: 2 } });
    expect(r3.lines.map((l) => l.approvalReason)).toEqual(["belowMin", "belowMin", null]);
  });
});

describe("parseBahtToSatang max", () => {
  it("defaults to the unit price limit and accepts a larger limit for discounts", async () => {
    const { parseBahtToSatang, MAX_PRICE_SATANG } = await import("@/server/domain/money");
    expect(parseBahtToSatang("10000000.01")).toBeNull();
    expect(parseBahtToSatang("10000000.00")).toBe(MAX_PRICE_SATANG);
    expect(parseBahtToSatang("25,000,000.00", 1_000_000_000_000)).toBe(2_500_000_000);
    expect(parseBahtToSatang(25_000_000, 1_000_000_000_000)).toBe(2_500_000_000);
    expect(parseBahtToSatang("10000000000.01", 1_000_000_000_000)).toBeNull();
  });
});
