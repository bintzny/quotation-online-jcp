import { getCurrentUser, onboardingRedirect } from "@/server/session";
import { buildTemplate } from "@/server/excel";
import { CUSTOMER_COLUMNS, PRODUCT_COLUMNS } from "@/server/domain/imports";

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
