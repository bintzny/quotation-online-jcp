import "server-only";
import ExcelJS from "exceljs";
import { mapHeaders, type Column } from "@/server/domain/imports";
import { zipUncompressedSize } from "@/server/domain/zip";

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

/** Columns whose numbers must keep leading zeros when Excel stored them as numbers. */
const ZERO_PAD: Record<string, number> = { taxId: 13, branchCode: 5 };
/** Columns that are identifiers: always text, even when typed as numbers. */
const TEXT_KEYS = new Set(["taxId", "branchCode", "expressCode", "salesCode", "code", "phone", "contactPhone"]);

const HEADER_FILL = "FF1F3A5F";
const EXAMPLE_FILL = "FFEDEDED";

/** Template: header row (required columns marked *), one grey example row, and a notes sheet. */
export async function buildTemplate(opts: { sheetName: string; columns: Column[]; notes: string[] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quotation JCP";
  const ws = wb.addWorksheet(opts.sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = opts.columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: { font: { name: "Tahoma", size: 10 }, ...(TEXT_KEYS.has(c.key) ? { numFmt: "@" } : {}) },
  }));
  const header = ws.getRow(1);
  header.height = 30;
  header.eachCell((cell, i) => {
    const col = opts.columns[i - 1];
    cell.value = col.header;
    cell.font = { name: "Tahoma", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: col.required ? "FFB4232A" : HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  const example = ws.addRow(Object.fromEntries(opts.columns.map((c) => [c.key, TEXT_KEYS.has(c.key) ? String(c.example) : c.example])));
  example.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXAMPLE_FILL } };
    cell.font = { name: "Tahoma", size: 10, italic: true, color: { argb: "FF666666" } };
  });

  const notes = wb.addWorksheet("คำอธิบาย");
  notes.getColumn(1).width = 110;
  opts.notes.forEach((n, i) => {
    const cell = notes.getCell(i + 1, 1);
    cell.value = n;
    cell.font = { name: "Tahoma", size: 10, bold: i === 0 };
    cell.alignment = { wrapText: true };
  });
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellToValue(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("result" in v) return cellToValue(v.result as ExcelJS.CellValue);
    if ("text" in v) return (v as { text: string }).text;
    if ("error" in v) return null;
    return String(v);
  }
  return v;
}

export type SheetReadResult =
  | { ok: true; rows: { rowNumber: number; raw: Record<string, unknown> }[] }
  | { ok: false; error: "notXlsx" | "tooBig" | "unreadable" | "empty" | "tooManyRows" | "missingColumns"; missing?: string[] };

/** Limits checked on the zip's central directory BEFORE anything is decompressed (zip bombs). */
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;

const HEADER_SCAN_ROWS = 10;
const PHONE_KEYS = new Set(["phone", "contactPhone"]);

/**
 * Read the first worksheet. The header row is the first of the top rows that contains every
 * required column (exports often start with a report title). The grey example row is skipped.
 */
export async function readSheet(file: File, columns: Column[]): Promise<SheetReadResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: "tooBig" };
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, error: "notXlsx" };
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return { ok: false, error: "notXlsx" }; // "PK" zip
  const zip = zipUncompressedSize(buf);
  if (!zip) return { ok: false, error: "unreadable" };
  if (zip.entries > MAX_ZIP_ENTRIES || zip.bytes > MAX_UNCOMPRESSED_BYTES) return { ok: false, error: "tooBig" };

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const ws = wb.worksheets[0];
  if (!ws || ws.actualRowCount < 1) return { ok: false, error: "empty" };
  if (ws.actualRowCount > MAX_IMPORT_ROWS + HEADER_SCAN_ROWS) return { ok: false, error: "tooManyRows" };

  let headerRowNumber = 0;
  let index: Record<string, number> = {};
  let missing: string[] = columns.filter((c) => c.required).map((c) => c.header);
  for (let n = 1; n <= Math.min(HEADER_SCAN_ROWS, ws.rowCount) && !headerRowNumber; n++) {
    const values = (ws.getRow(n).values as ExcelJS.CellValue[]).slice(1).map(cellToValue);
    if (!values.some((x) => x !== null && String(x).trim() !== "")) continue;
    const mapped = mapHeaders(values, columns);
    if (mapped.missing.length === 0) {
      headerRowNumber = n;
      index = mapped.index;
    } else if (mapped.missing.length < missing.length) {
      missing = mapped.missing; // report the closest header row we saw
    }
  }
  if (!headerRowNumber) return { ok: false, error: "missingColumns", missing };

  const rows: { rowNumber: number; raw: Record<string, unknown> }[] = [];
  ws.eachRow((row, n) => {
    if (n <= headerRowNumber) return;
    const raw: Record<string, unknown> = {};
    for (const [key, i] of Object.entries(index)) {
      const cell = row.getCell(i + 1);
      let val = cellToValue(cell.value);
      if (typeof val === "number" && TEXT_KEYS.has(key)) {
        // Identifiers typed as numbers: use the text Excel displays (keeps "000123" with a 000000 format).
        let text = (cell.text ?? "").trim() || String(val);
        if (/e/i.test(text)) text = BigInt(Math.round(val)).toString(); // 1.05561E+11 style display
        if (ZERO_PAD[key]) text = text.padStart(ZERO_PAD[key], "0");
        // Thai phone numbers lose their leading 0 when stored as numbers (812345678 → 0812345678).
        if (PHONE_KEYS.has(key) && /^[1-9]\d{7,8}$/.test(text)) text = `0${text}`;
        val = text;
      }
      raw[key] = val;
    }
    if (Object.values(raw).every((x) => x === null || x === undefined || String(x).trim() === "")) return;
    // skip the template's example row if it was left in (every column equals the example)
    const isExample = n === headerRowNumber + 1 &&
      columns.every((c) => index[c.key] === undefined || String(raw[c.key] ?? "").trim() === String(c.example));
    if (isExample) return;
    rows.push({ rowNumber: n, raw });
  });
  if (rows.length === 0) return { ok: false, error: "empty" };
  if (rows.length > MAX_IMPORT_ROWS) return { ok: false, error: "tooManyRows" };
  return { ok: true, rows };
}

// ── Report exports ──

export type ExportColumn = {
  header: string;
  key: string;
  width: number;
  type?: "text" | "money" | "date" | "datetime" | "int" | "qty" | "price" | "percent";
  total?: boolean; // add a SUM formula under this column
};

export type ExportSheet = { name: string; columns: ExportColumn[]; rows: Record<string, unknown>[]; title?: string[] };

const NUM_FMT: Record<string, string> = {
  money: "#,##0.00", price: "#,##0.00##", int: "#,##0", qty: "#,##0.###", date: "dd/mm/yyyy", datetime: "dd/mm/yyyy hh:mm", percent: "0.0%",
};

/** Workbook with one table per sheet: title lines, bold header, frozen header, totals as formulas. */
export async function buildExport(sheets: ExportSheet[], opts: { totalLabel: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Quotation JCP";
  wb.calcProperties.fullCalcOnLoad = true;
  for (const s of sheets) {
    const titleRows = s.title?.length ?? 0;
    const headerRow = titleRows + (titleRows > 0 ? 2 : 1);
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: headerRow }] });
    ws.properties.defaultRowHeight = 18;
    s.title?.forEach((line, i) => {
      const cell = ws.getCell(i + 1, 1);
      cell.value = line;
      cell.font = { name: "Tahoma", size: i === 0 ? 12 : 10, bold: i === 0 };
    });
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width;
      const h = ws.getCell(headerRow, i + 1);
      h.value = c.header;
      h.font = { name: "Tahoma", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      h.alignment = { vertical: "middle", wrapText: true };
    });
    ws.getRow(headerRow).height = 30;
    s.rows.forEach((r, ri) => {
      const rowNo = headerRow + 1 + ri;
      s.columns.forEach((c, ci) => {
        const cell = ws.getCell(rowNo, ci + 1);
        const v = r[c.key];
        cell.value = v === undefined || v === null || v === "" ? null : c.type === "text" || !c.type ? String(v) : (v as ExcelJS.CellValue);
        cell.font = { name: "Tahoma", size: 10 };
        if (c.type && NUM_FMT[c.type]) cell.numFmt = NUM_FMT[c.type];
        if (!c.type || c.type === "text") cell.numFmt = "@";
      });
    });
    if (s.columns.some((c) => c.total) && s.rows.length > 0) {
      // One empty row keeps the total out of the filter/sort range; SUBTOTAL(109) follows the filter.
      const lastData = headerRow + s.rows.length;
      const totalRow = lastData + 2;
      ws.getCell(totalRow, 1).value = opts.totalLabel;
      s.columns.forEach((c, ci) => {
        const cell = ws.getCell(totalRow, ci + 1);
        cell.font = { name: "Tahoma", size: 10, bold: true };
        if (!c.total) return;
        const letter = ws.getColumn(ci + 1).letter;
        const result = s.rows.reduce((sum, r) => sum + (typeof r[c.key] === "number" ? (r[c.key] as number) : 0), 0);
        cell.value = { formula: `SUBTOTAL(109,${letter}${headerRow + 1}:${letter}${lastData})`, result: Math.round(result * 100) / 100 };
        cell.numFmt = NUM_FMT[c.type ?? "money"] ?? NUM_FMT.money;
      });
    }
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: s.columns.length } };
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Response headers for a download with a Thai file name. */
export function xlsxHeaders(fileName: string): HeadersInit {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "no-store",
  };
}
