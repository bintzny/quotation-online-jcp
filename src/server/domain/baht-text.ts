// Amount in Thai words, as printed on Thai business documents (pure).
// 123456 satang → "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบหกสตางค์", 10000 → "หนึ่งร้อยบาทถ้วน".

const DIGITS = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** 1 – 999,999 in words. "เอ็ด" for a trailing 1 after tens, "ยี่สิบ" for 20s, "สิบ" for 10s. */
function belowMillion(n: number): string {
  const digits = String(n).split("").map(Number);
  const len = digits.length;
  let out = "";
  digits.forEach((d, i) => {
    const place = len - 1 - i;
    if (d === 0) return;
    if (place === 1) out += d === 1 ? "สิบ" : d === 2 ? "ยี่สิบ" : `${DIGITS[d]}สิบ`;
    else if (place === 0) out += d === 1 && len > 1 ? "เอ็ด" : DIGITS[d];
    else out += DIGITS[d] + PLACES[place];
  });
  return out;
}

/** Whole number in words; millions repeat ("หนึ่งล้านล้าน"). 0 → "ศูนย์". */
export function thaiNumberWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`Bad number ${n}`);
  if (n === 0) return "ศูนย์";
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  const head = millions > 0 ? `${thaiNumberWords(millions)}ล้าน` : "";
  // a trailing 1 after a million is still "เอ็ด" (1,000,001 = หนึ่งล้านเอ็ด)
  const tail = rest === 0 ? "" : rest === 1 && millions > 0 ? "เอ็ด" : belowMillion(rest);
  return head + tail;
}

export function bahtText(satang: number): string {
  if (!Number.isSafeInteger(satang) || satang < 0) throw new Error(`Bad amount ${satang}`);
  const baht = Math.floor(satang / 100);
  const st = satang % 100;
  if (baht === 0 && st === 0) return "ศูนย์บาทถ้วน";
  const bahtPart = baht > 0 ? `${thaiNumberWords(baht)}บาท` : "";
  return st === 0 ? `${bahtPart}ถ้วน` : `${bahtPart}${thaiNumberWords(st)}สตางค์`;
}
