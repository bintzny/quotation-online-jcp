// Amount in English words for English quotations (pure).
// 856000 satang → "Eight Thousand Five Hundred Sixty Baht Only".

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ""));
  else if (r) parts.push(ONES[r]);
  return parts.join(" ");
}

export function englishNumberWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Bad number ${n}`);
  if (n === 0) return "Zero";
  const groups: string[] = [];
  let rest = n;
  let scale = 0;
  while (rest > 0) {
    const g = rest % 1000;
    if (g) groups.unshift(`${belowThousand(g)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
    rest = Math.floor(rest / 1000);
    scale++;
  }
  return groups.join(" ");
}

export function bahtTextEn(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) throw new Error(`Bad amount ${satang}`);
  const baht = Math.floor(satang / 100);
  const st = satang % 100;
  if (st === 0) return `${englishNumberWords(baht)} Baht Only`;
  return baht === 0 ? `${englishNumberWords(st)} Satang` : `${englishNumberWords(baht)} Baht and ${englishNumberWords(st)} Satang`;
}
