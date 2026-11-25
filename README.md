# Quotation Online JCP

ระบบใบเสนอราคาออนไลน์ — Next.js 16 + TypeScript + Prisma 7 + PostgreSQL + Better Auth

- ความต้องการ: [docs/requirements.md](docs/requirements.md)
- สถาปัตยกรรมและลำดับงาน: [docs/architecture.md](docs/architecture.md)

## สถานะ

- **M0 เสร็จ**: ล็อกอิน, ลืมรหัสผ่าน, บังคับเปลี่ยนรหัสผ่านครั้งแรก, ล็อกบัญชีเมื่อผิด 5 ครั้ง, 2FA (บังคับผู้บริหาร/แอดมิน), จัดการผู้ใช้และบริษัท, ประวัติการแก้ไข, ไทย/อังกฤษ
- **M1 เสร็จ**: ลูกค้า (ผู้ดูแล, กันลูกค้าซ้ำ, ผู้ติดต่อ, ประวัติเปลี่ยนผู้ดูแล, รายการรอเลือกผู้ดูแล), สินค้า (ซ่อนราคาขั้นต่ำจากพนักงานขาย), นำเข้าลูกค้า/สินค้าจาก Excel
- **M2 เสร็จ**: ใบเสนอราคา (ออกเลขที่อัตโนมัติแยกบริษัท/เดือน, ส่วนลดรายบรรทัดและท้ายบิล, VAT, ยอดเงินตัวหนังสือไทย, เตือนรายการที่ต้องขออนุมัติ, ส่งลูกค้าแล้ว, แก้ไขเป็นฉบับใหม่ R1/R2, คัดลอก, ยกเลิก)
- **M3 เสร็จ**: PDF ใบเสนอราคาไทย/อังกฤษ (หัวกระดาษและโลโก้บริษัท, ลายเซ็นพนักงานขาย, ลายน้ำ "ฉบับร่าง"), เก็บ PDF ที่ส่งลูกค้าทุกฉบับ, ส่งอีเมลแนบ PDF จากระบบ (ในเครื่องพัฒนาเขียนลง `storage/outbox/` จนกว่าจะตั้ง Resend)

## เริ่มพัฒนาในเครื่อง (Windows)

1. เปิดฐานข้อมูลสำหรับพัฒนา (embedded PostgreSQL, port 55433) แล้วเปิดค้างไว้

   ```powershell
   node $env:USERPROFILE\quotation-jcp-devdb\pg.mjs
   ```

2. ตั้งค่าครั้งแรก

   ```powershell
   Copy-Item .env.example .env   # แล้วใส่ BETTER_AUTH_SECRET
   npm install
   npm run db:deploy
   npm run db:seed:demo          # สร้างแอดมิน + ข้อมูลตัวอย่าง รหัสผ่านอยู่ใน .dev-credentials.txt
   ```

3. รันเว็บ: `npm run dev` แล้วเปิด http://localhost:3000

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `npm run dev` | รันเว็บโหมดพัฒนา |
| `npm test` | unit test (Vitest) |
| `npm run typecheck` | ตรวจ TypeScript |
| `npm run lint` | ESLint |
| `npm run db:migrate` | สร้าง/รัน migration หลังแก้ `prisma/schema.prisma` |
| `npm run db:seed` | สร้างแอดมินคนแรก (ถ้ายังไม่มีผู้ใช้) |
| `node --env-file=.env tests/smoke/m3-documents.mjs` | smoke test สิทธิ์ดาวน์โหลด PDF/รูปลายเซ็น, ไฟล์ใน storage ไม่เปิดสาธารณะ, PDF ที่ส่งแล้วตรงกับไฟล์ที่เก็บ (ต้องมีใบของ sales1 ที่ส่งลูกค้าแล้ว) |
| `node --env-file=.env tests/smoke/m2-quotations.mjs` | smoke test สิทธิ์ใบเสนอราคา (พนักงานขายคนอื่น/ผู้บริหาร/แอดมิน), ราคาขั้นต่ำไม่หลุด, เลขที่ไม่ซ้ำเมื่อยิงพร้อมกัน (ต้องมีใบเสนอราคาของ sales1 อย่างน้อย 1 ใบ) |
| `node --env-file=.env tests/smoke/m1-customers.mjs` | smoke test สิทธิ์การมองเห็นลูกค้า/ราคาขั้นต่ำของพนักงานขาย (ต้องนำเข้าข้อมูลทดสอบ M1 ก่อน) |
| `node --env-file=.env tests/smoke/m0-auth.mjs` | smoke test ล็อกอิน/สิทธิ์/การโจมตี (ต้องรันเว็บอยู่ และ seed demo ใหม่ก่อน ใช้เวลาประมาณ 2 นาที) |

## หมายเหตุ

- อีเมล (ลืมรหัสผ่าน) ยังไม่ส่งจริงจนถึง M3 — โหมดพัฒนาจะพิมพ์ลิงก์ไว้ใน console ของเซิร์ฟเวอร์
- `.env` และ `.dev-credentials.txt` ห้าม commit (อยู่ใน `.gitignore` แล้ว)
