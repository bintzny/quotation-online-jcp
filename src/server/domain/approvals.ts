// Approval rules (pure).
//
// After an approval (or a counter-offer) the decision records, for every line that needed it, the
// net unit price that was allowed. Later edits stay approved while each such line keeps a net unit
// price at or above what was allowed; going lower needs a new request. Lines that never needed
// approval do not matter. An approval belongs to its quotation only (never to the customer).

export type ApprovedLine = { key: string; quantityMilli: number; finalSatang: number };

export type LineForApproval = {
  productId: string | null;
  productCode: string | null;
  name: string;
  unit: string;
  quantityMilli: number;
  finalSatang: number; // net amount after line discount and bill-discount share
  approvalReason: string | null;
};

/** The same product (or the same free-typed line) across edits. */
export function lineKey(l: Pick<LineForApproval, "productId" | "productCode" | "name" | "unit">): string {
  if (l.productId) return `p:${l.productId}`;
  if (l.productCode) return `c:${l.productCode}`;
  return `t:${l.name.trim().toLowerCase()}|${l.unit.trim().toLowerCase()}`;
}

/** a/aQty ≥ b/bQty without division (exact for any safe integers). */
export function unitPriceAtLeast(aFinal: number, aQty: number, bFinal: number, bQty: number): boolean {
  return BigInt(aFinal) * BigInt(bQty) >= BigInt(bFinal) * BigInt(aQty);
}

/** What a decision allows: the current net unit price of every line that needed approval. */
export function approvedLinesOf(lines: LineForApproval[]): ApprovedLine[] {
  return lines
    .filter((l) => l.approvalReason !== null)
    .map((l) => ({ key: lineKey(l), quantityMilli: l.quantityMilli, finalSatang: l.finalSatang }));
}

/** Per line: is it fine without a new request? (true for lines that need no approval at all) */
export function coveredLines(approved: ApprovedLine[] | null, lines: LineForApproval[]): boolean[] {
  return lines.map((l) => {
    if (l.approvalReason === null) return true;
    if (!approved) return false;
    const key = lineKey(l);
    return approved.some((a) => a.key === key && unitPriceAtLeast(l.finalSatang, l.quantityMilli, a.finalSatang, a.quantityMilli));
  });
}

export function approvalCovers(approved: ApprovedLine[] | null, lines: LineForApproval[]): boolean {
  return coveredLines(approved, lines).every(Boolean);
}

/** Read approvedLines from JSON safely (anything malformed counts as "no approval"). */
export function parseApprovedLines(json: unknown): ApprovedLine[] | null {
  if (!Array.isArray(json)) return null;
  const out: ApprovedLine[] = [];
  for (const x of json) {
    if (!x || typeof x !== "object") return null;
    const { key, quantityMilli, finalSatang } = x as Record<string, unknown>;
    if (typeof key !== "string" || !Number.isSafeInteger(quantityMilli) || !Number.isSafeInteger(finalSatang)) return null;
    out.push({ key, quantityMilli: quantityMilli as number, finalSatang: finalSatang as number });
  }
  return out;
}
