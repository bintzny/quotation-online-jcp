import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";

// Prints HTML to PDF with Chrome. One shared browser per server process; at most a few pages at a
// time. The page has JavaScript off and every request except data: URIs is blocked, so the
// document can only show what the template put in it.

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
];

function chromePath(): string {
  const found = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!found) throw new Error("Chrome/Chromium not found: set CHROME_PATH");
  return found;
}

const g = globalThis as unknown as { __pdfBrowser?: Promise<Browser> };

function browser(): Promise<Browser> {
  if (!g.__pdfBrowser) {
    g.__pdfBrowser = puppeteer
      .launch({
        executablePath: chromePath(),
        headless: true,
        // Containers run as root without a user namespace; the page itself is locked down below.
        args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), "--disable-dev-shm-usage", "--font-render-hinting=none"],
      })
      .then((b) => {
        b.on("disconnected", () => { g.__pdfBrowser = undefined; });
        return b;
      })
      .catch((e) => {
        g.__pdfBrowser = undefined;
        throw e;
      });
  }
  return g.__pdfBrowser;
}

/** Too many PDFs are being printed right now: the caller should ask the user to try again. */
export class PdfBusyError extends Error {
  constructor() {
    super("PDF renderer busy");
  }
}

// Small semaphore with a bounded queue: Chrome pages are heavy, and a burst of downloads must not
// make everyone else (e.g. someone sending a quotation) wait without limit.
const MAX_PAGES = 2;
const MAX_WAITING = 20;
const MAX_WAIT_MS = 30_000;
let active = 0;
const waiting: { resolve: () => void; timer: NodeJS.Timeout }[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PAGES) {
    if (waiting.length >= MAX_WAITING) throw new PdfBusyError();
    await new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        timer: setTimeout(() => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          reject(new PdfBusyError());
        }, MAX_WAIT_MS),
      };
      waiting.push(entry);
    });
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiting.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    }
  }
}

let fontCssCache: Promise<string> | null = null;

/** Sarabun (SIL OFL) embedded as data URIs: Thai + Latin, regular and bold. */
export function fontCss(): Promise<string> {
  fontCssCache ??= (async () => {
    const dir = path.join(process.cwd(), "node_modules", "@fontsource", "sarabun", "files");
    const faces: string[] = [];
    for (const weight of [400, 700]) {
      for (const subset of ["thai", "latin"]) {
        const data = await readFile(path.join(dir, `sarabun-${subset}-${weight}-normal.woff2`));
        faces.push(`@font-face { font-family: "Sarabun"; font-style: normal; font-weight: ${weight}; src: url(data:font/woff2;base64,${data.toString("base64")}) format("woff2"); }`);
      }
    }
    return faces.join("\n");
  })().catch((e) => {
    fontCssCache = null;
    throw e;
  });
  return fontCssCache;
}

/** Footer text must be plain ASCII (the footer cannot use the embedded font). */
export async function htmlToPdf(html: string, footerLabel: string): Promise<Buffer> {
  const safeFooter = footerLabel.replace(/[^A-Za-z0-9 ._-]/g, "");
  return slot(async () => {
    const b = await browser();
    const page = await b.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const url = req.url();
        if (url.startsWith("data:") || url === "about:blank") req.continue();
        else req.abort();
      });
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: `<div style="width:100%;font-size:8px;color:#666;padding:0 12mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>${safeFooter}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
        timeout: 30_000,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => {});
    }
  });
}
