import { getCurrentUser, onboardingRedirect } from "@/server/session";
import { buildTemplate } from "@/server/excel";
import { CUSTOMER_COLUMNS, LAST_SALE_COLUMNS, PRODUCT_COLUMNS } from "@/server/domain/imports";

const TEMPLATES = {
  customers: {
    file: "customer-import-template.xlsx",
    sheetName: "ลูกค้า",
    columns: CUSTOMER_COLUMNS,
    notes: [
      "วิธีกรอกแม่แบบนำเข้าลูกค้า",
      "1. กรอกข้อมูลตั้งแต่แถวที่ 3 เป็นต้นไป (แถวที่ 2 สีเทาเป็นตัวอย่าง สามารถลบหรือคงไว้ได้ ระบบจะไม่นำเข้าแถวนี้)",
      "2. หัวคอลัมน์สีแดงต้องกรอกทุกแถว ห้ามแก้ชื่อหัวคอลัมน์",
      "3. ประเภท: กรอก นิติบุคคล หรือ บุคคลธรรมดา — นิติบุคคลต้องมีเลขประจำตัวผู้เสียภาษี 13 หลัก",
      "4. รหัสสาขา: 00000 = สำนักงานใหญ่ หากเป็นสำนักงานใหญ่สามารถเว้นว่างได้",
      "5. รหัสพนักงานขาย: ต้องตรงกับรหัสพนักงานขายที่ตั้งไว้ในหน้า ผู้ใช้งาน ของระบบ",
      "6. นำเข้าทีละบริษัท ลูกค้าที่มีเลขผู้เสียภาษีและสาขาเดียวกันในหลายบริษัทจะถูกรวมเป็นรายเดียว หากพนักงานขายต่างกัน ลูกค้าจะเข้ารายการ “รอเลือกผู้ดูแล” ยกเว้นลูกค้าที่ผู้บริหารกำหนดผู้ดูแลไว้แล้ว ระบบจะคงผู้ดูแลเดิม",
      "7. ระบบไม่เขียนทับข้อมูลลูกค้าเดิม จะเติมเฉพาะช่องที่ยังว่างอยู่", "8. ลูกค้าบุคคลธรรมดาควรมีรหัสลูกค้า Express เสมอ มิฉะนั้นการนำเข้าครั้งถัดไปจะเพิ่มเป็นลูกค้ารายใหม่ซ้ำ",
    ],
  },
  products: {
    file: "product-import-template.xlsx",
    sheetName: "สินค้า",
    columns: PRODUCT_COLUMNS,
    notes: [
      "วิธีกรอกแม่แบบนำเข้าสินค้า",
      "1. กรอกข้อมูลตั้งแต่แถวที่ 3 เป็นต้นไป (แถวที่ 2 สีเทาเป็นตัวอย่าง)",
      "2. หัวคอลัมน์สีแดงต้องกรอกทุกแถว ห้ามแก้ชื่อหัวคอลัมน์",
      "3. ราคาเป็นบาท ก่อนภาษีมูลค่าเพิ่ม ทศนิยมไม่เกิน 2 ตำแหน่ง",
      "4. ราคาขั้นต่ำต้องไม่สูงกว่าราคาปกติ และต้องกรอกทุกรายการ ยกเว้นรายการบริการ (เช่น ค่าขนส่ง)",
      "5. รหัสสินค้าที่มีอยู่แล้วจะถูกอัปเดตตามไฟล์ทั้งหมด รวมถึงราคาขั้นต่ำ",
    ],
  },
  "last-sales": {
    file: "last-sale-import-template.xlsx",
    sheetName: "วันที่ขายล่าสุด",
    columns: LAST_SALE_COLUMNS,
    notes: [
      "วิธีกรอกแม่แบบนำเข้าวันที่ขายล่าสุดจาก Express",
      "1. นำเข้าทีละบริษัท เดือนละครั้ง กรอกข้อมูลตั้งแต่แถวที่ 3 เป็นต้นไป (แถวที่ 2 สีเทาเป็นตัวอย่าง)",
      "2. แต่ละแถวต้องมีรหัสลูกค้า Express หรือเลขประจำตัวผู้เสียภาษี อย่างน้อยหนึ่งอย่าง ระบบจับคู่ด้วยรหัสลูกค้า Express ของบริษัทที่เลือกก่อน แล้วจึงใช้เลขผู้เสียภาษีและรหัสสาขา",
      "3. วันที่ขายล่าสุด: ใช้ช่องวันที่ของ Excel หรือพิมพ์ วัน/เดือน/ปี ได้ทั้งปี ค.ศ. และ พ.ศ. เช่น 20/11/2569",
      "4. ยอดขาย 12 เดือนล่าสุด (ไม่บังคับ): เป็นบาท ก่อนภาษีมูลค่าเพิ่ม ใช้แสดงเป็นยอดซื้อเดิมของลูกค้าที่หายไป หากเว้นว่าง ระบบคงค่าเดิมไว้",
      "5. วันที่ที่เก่ากว่าข้อมูลที่นำเข้าไว้แล้วจะไม่ถูกนำมาใช้ ระบบไม่ย้อนวันที่ขายล่าสุดกลับ",
      "6. ลูกค้าที่ถูกบันทึกว่าเสียไป หากมีวันที่ขายหลังวันที่บันทึก จะกลับเป็นลูกค้าปกติโดยอัตโนมัติ",
      "7. แถวที่ไม่พบลูกค้าในระบบจะถูกข้าม และแสดงหมายเลขแถวในหน้าตรวจไฟล์",
    ],
  },
} as const;

export async function GET(_req: Request, ctx: RouteContext<"/api/templates/[kind]">) {
  const user = await getCurrentUser();
  if (!user || onboardingRedirect(user) || !user.roles.includes("admin")) {
    return new Response("Not found", { status: 404 });
  }
  const { kind } = await ctx.params;
  const tpl = TEMPLATES[kind as keyof typeof TEMPLATES];
  if (!tpl) return new Response("Not found", { status: 404 });
  const buf = await buildTemplate({ sheetName: tpl.sheetName, columns: tpl.columns, notes: [...tpl.notes] });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${tpl.file}"`,
      "Cache-Control": "no-store",
    },
  });
}
