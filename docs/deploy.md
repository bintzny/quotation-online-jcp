# คู่มือขึ้นระบบจริงบน Render (M8)

ไฟล์ที่ใช้: [`render.yaml`](../render.yaml) (Blueprint), [`Dockerfile`](../Dockerfile), [`deploy/`](../deploy) (สคริปต์เริ่มระบบ, migration, cron)

## ภาพรวม

| ส่วน | บน Render | หมายเหตุ |
|---|---|---|
| เว็บ `quotation-web` | Web Service แบบ Docker, Singapore, 1 CPU / 2 GB (Standard) | มี Chromium สำหรับสร้าง PDF, รันด้วย user `node` (ไม่ใช่ root) |
| ไฟล์ | Persistent Disk 5 GB ที่ `/var/data` (`STORAGE_DIR=/var/data/storage`) | Render สำรองดิสก์ให้วันละครั้ง เก็บ 7 วัน |
| ฐานข้อมูล `quotation-db` | PostgreSQL 17, Singapore | ปิดการเชื่อมต่อจากอินเทอร์เน็ต (`ipAllowList: []`) |
| Cron | `quotation-cron-approvals` ทุก 15 นาที, `quotation-cron-daily` ทุกชั่วโมงนาทีที่ 5 | เรียก `/api/cron/*` ของเว็บด้วย `CRON_SECRET` |

ข้อจำกัดที่ยอมรับแล้ว (ตัดสินใจใน M8):
- เว็บที่มีดิสก์รันได้ **1 instance** และ **ระหว่าง deploy ระบบหยุดประมาณไม่กี่วินาทีถึง 1 นาที** จึง deploy นอกเวลาทำงาน
- ถ้าต่อไปต้องขยายหลาย instance ให้ย้ายไฟล์ไป Cloudflare R2 (เพิ่ม driver ใน `src/server/storage.ts`)

## 1. สิ่งที่ต้องเตรียมก่อน

- [ ] บัญชี Render และเชื่อม GitHub repo นี้ (pre-deploy command ใช้ได้กับบริการแบบเสียเงิน ซึ่งเว็บ Standard เป็นอยู่แล้ว ส่วนระยะเวลากู้คืนฐานข้อมูลย้อนหลังขึ้นกับ workspace plan ดูขั้นที่ 8)
- [ ] โดเมนสำหรับระบบ เช่น `quotation.<บริษัท>.co.th` และผู้ที่แก้ DNS ได้
- [ ] บัญชี Resend และผู้แก้ DNS ของ **ทั้ง 2 โดเมนอีเมล** ที่บริษัทใช้ส่ง
- [ ] อีเมลของแอดมินคนแรก
- [ ] บริษัทนำร่อง: โลโก้ (PNG/JPG), ข้อมูลหัวกระดาษ, รายชื่อผู้ใช้และบทบาท, ไฟล์ลูกค้า/สินค้าจาก Express

## 2. สร้างระบบด้วย Blueprint

1. Render Dashboard → **New → Blueprint** → เลือก repo นี้ branch `master`
2. Render แสดงรายการที่จะสร้างพร้อมราคา ตรวจ plan ของแต่ละตัว (เว็บ Standard 2 GB, ฐานข้อมูลขนาดเล็กสุดแบบเสียเงิน) ถ้าชื่อ plan ใน `render.yaml` ไม่ตรงกับที่ Render มีในตอนนั้น ให้เลือกในหน้านี้แล้วแก้ไฟล์ตาม
3. กรอกค่าที่ Render ถาม (ค่า `sync: false`)
   - `APP_URL` และ `BETTER_AUTH_URL`: ระบุเป็น `https://quotation-web.onrender.com` เป็นการชั่วคราว (ไม่มี `/` ท้าย) แล้วเปลี่ยนเป็นโดเมนจริงในขั้นที่ 3
   - `RESEND_API_KEY`, `MAIL_FROM` (เช่น `"Quotation JCP" <no-reply@โดเมน>`)
   - `SEED_ADMIN_EMAIL`: อีเมลแอดมินคนแรก
   - `BETTER_AUTH_SECRET` และ `CRON_SECRET` Render สุ่มให้เอง **ห้ามคัดลอกไปเก็บในไฟล์หรือแชต**
4. กด Apply แล้วรอ deploy ครั้งแรก
   - ระหว่าง deploy, pre-deploy command (`/usr/local/bin/migrate.sh`) รัน `prisma migrate deploy` ก่อนเปิดเวอร์ชันใหม่ ซึ่งรวม migration ที่ตั้งเขตเวลาฐานข้อมูลเป็น UTC
   - ถ้าค่าที่จำเป็นขาด เว็บจะไม่เริ่มทำงานและ log บอกชื่อค่าที่ขาด (`[config] …`)
5. คัดลอก URL จริงจากหน้า service `quotation-web` (ถ้าชื่อซ้ำกับบริการอื่น Render จะเติมคำต่อท้าย) ถ้าไม่ตรงกับที่ระบุในข้อ 3 ให้แก้ `APP_URL` และ `BETTER_AUTH_URL` ให้ตรงกันทั้ง 2 ค่า มิฉะนั้นจะเข้าสู่ระบบไม่ได้
6. เปิด `<URL จริง>/api/health` ต้องได้ `{"ok":true,"db":true,"timezone":true,"storage":true}`

> **ข้อควรระวังเมื่อแก้ค่า environment**: เว็บที่มีดิสก์ถาวร Render จะหยุดเวอร์ชันเดิมก่อนเปิดเวอร์ชันใหม่ ถ้าค่าที่แก้ผิด (เช่น URL ไม่ขึ้นต้นด้วย `https://`) เวอร์ชันใหม่จะไม่เริ่มทำงาน และระบบจะหยุดจนกว่าจะแก้ค่า ให้ตรวจค่าก่อนกด Save ดู log ระหว่าง deploy และถ้าล้มเหลวให้แก้ค่าทันทีหรือกด Rollback

## 3. โดเมน

1. หน้า service `quotation-web` → Settings → Custom Domains → เพิ่มโดเมน
2. ที่ DNS ของบริษัท เพิ่ม CNAME ตามที่ Render บอก รอ Render ออกใบรับรอง HTTPS ให้
3. เปลี่ยน `APP_URL` และ `BETTER_AUTH_URL` เป็น `https://<โดเมนจริง>` แล้ว Save (Render deploy ใหม่ให้)
4. หน้า Blueprint → **Manual Sync** เพื่อให้ cron ทั้ง 2 งานได้ `APP_URL` ใหม่ (ค่าที่ cron อ่านจากเว็บผ่าน `fromService` อัปเดตเฉพาะตอน sync และต้อง sync ทุกครั้งที่เปลี่ยน `APP_URL` หรือ `CRON_SECRET`)
5. เปิด `https://<โดเมน>/api/health` อีกครั้ง

## 4. อีเมล (Resend)

1. ใน Resend เพิ่มทั้ง 2 โดเมนอีเมล แล้วให้ผู้ดูแล DNS ใส่ระเบียน SPF / DKIM (และ MX ของ subdomain ที่ Resend ใช้รับ bounce) จนสถานะเป็น Verified
2. สร้าง API key แบบ "Sending access" เท่านั้น ใส่ใน `RESEND_API_KEY`
3. ในระบบ ตั้งอีเมลผู้ส่งของแต่ละบริษัท (หน้าตั้งค่าบริษัท) ให้อยู่ในโดเมนที่ยืนยันแล้ว
4. ทดสอบ: ลืมรหัสผ่าน (อีเมลระบบจาก `MAIL_FROM`) และส่งใบเสนอราคาทดสอบถึงอีเมลตัวเองจาก **ทั้ง 2 บริษัท** ตรวจว่าไม่เข้า spam และ PDF แนบภาษาไทยถูกต้อง

## 5. แอดมินคนแรก

1. หน้า service `quotation-web` → **Shell**
2. รัน

   ```sh
   cd /opt/tools && PATH=/opt/tools/node_modules/.bin:$PATH node node_modules/prisma/build/index.js db seed
   cat .dev-credentials.txt
   rm .dev-credentials.txt
   ```

   seed สร้างแอดมินจาก `SEED_ADMIN_EMAIL` เฉพาะเมื่อยังไม่มีผู้ใช้เลย รหัสผ่านชั่วคราวอยู่ในไฟล์ (ไม่พิมพ์ใน log) อ่านแล้วลบทันที
3. เข้าสู่ระบบ เปลี่ยนรหัสผ่าน ตั้ง 2FA ตามที่ระบบบังคับ
4. **ห้ามรัน `db seed -- --demo` บน production** (สร้างผู้ใช้และบริษัทตัวอย่าง)

## 6. ตรวจ IP ผู้ใช้

rate limit การเข้าสู่ระบบ และ IP ใน audit log ต้องใช้ IP จริงของผู้ใช้ แต่ header `X-Forwarded-For` ผู้ใช้ปลอมได้ เอกสาร Render ไม่ได้ระบุว่า header ไหนเชื่อถือได้ จึงต้องตรวจบนระบบจริงหนึ่งครั้ง

1. หา IP ของเครื่องตัวเอง (เช่นเปิดเว็บที่แสดง public IP)
2. คัดลอก `CRON_SECRET` จากหน้า Environment ของ Render แล้วรันใน terminal (Git Bash หรือ Linux/macOS) คำสั่ง `read` รับค่าโดยไม่แสดงบนจอและไม่บันทึกลงประวัติคำสั่ง

   ```sh
   read -rs CRON_SECRET    # วางค่าแล้วกด Enter
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
        -H "X-Forwarded-For: 1.2.3.4" -H "True-Client-IP: 1.2.3.4" -H "CF-Connecting-IP: 1.2.3.4" \
        https://<โดเมน>/api/ops/ip-check
   ```

3. อ่านผล
   - header ที่แสดง **IP จริงของเรา** และ **ไม่ใช่ 1.2.3.4** คือ header ที่ proxy เขียนทับให้ ตั้ง `CLIENT_IP_HEADER` เป็นชื่อนั้น (เช่น `true-client-ip`)
   - ถ้าไม่มี header เดี่ยวที่เชื่อถือได้ ให้ดู `x-forwarded-for` แล้วนับจากขวาว่า IP จริงอยู่ตำแหน่งที่เท่าไร ตั้ง `TRUSTED_PROXY_HOPS` เป็นตัวเลขนั้น (ค่าเริ่มต้น 1 = ตัวขวาสุด) **ค่านี้แก้เฉพาะ IP ใน audit log** rate limit การเข้าสู่ระบบยังนับทุกคนรวมกัน ต้องแจ้งทีมพัฒนาเพื่อตั้ง `trustedProxies` ของ Better Auth ตามช่วง IP ของ proxy ก่อนเปิดใช้ทั้งบริษัท
4. Save ค่า แล้วรันคำสั่งเดิมอีกครั้ง `resolved` ต้องเป็น IP จริงของเรา
5. เมื่อตั้ง `CLIENT_IP_HEADER` แล้ว log ตอนเริ่มระบบจะไม่มีคำเตือน `CLIENT_IP_HEADER is not set` อีก

ก่อนตั้ง `CLIENT_IP_HEADER` ระบบยังปลอดภัย (ไม่เชื่อ IP ที่ผู้ใช้ปลอม) แต่ rate limit การเข้าสู่ระบบนับรวมทุกคนเป็นกลุ่มเดียว (30 ครั้ง/นาที) ผู้ไม่หวังดีที่ส่งคำขอถี่ ๆ จะทำให้ผู้อื่นเข้าสู่ระบบไม่ได้ชั่วคราว จึงต้องทำขั้นนี้ก่อนเปิดให้ผู้ใช้ทั้งบริษัท

## 7. ตรวจหลังขึ้นระบบ

- [ ] `/api/health` ได้ `ok: true`
- [ ] จากเครื่องพัฒนา: `node tests/smoke/m8-security.mjs https://<โดเมน>` ผ่านทุกข้อ (ทดสอบแบบไม่ล็อกอินเท่านั้น ไม่ส่งรหัสผ่านใด ๆ)
- [ ] หน้า Cron Jobs ของ Render: รอบล่าสุดของทั้ง 2 งานขึ้น `HTTP 200`
- [ ] สร้างใบเสนอราคา → ดาวน์โหลด PDF ภาษาไทย → ส่งอีเมล → ขออนุมัติ → อนุมัติบนมือถือ
- [ ] เขตเวลาและข้อมูล: ใน **Shell ของ `quotation-web`** รัน `cd /opt/tools && node db-check.mjs` ต้องได้ `database time zone: UTC` (Render Postgres ไม่มี Shell ของตัวเอง และฐานข้อมูลปิดการเชื่อมต่อจากภายนอก)
- [ ] หลังอัปโหลดโลโก้และส่งใบเสนอราคาแล้ว กด deploy ใหม่หนึ่งครั้ง โลโก้ ลายเซ็น และ PDF ที่ส่งแล้วต้องยังอยู่ (ไฟล์อยู่บนดิสก์ถาวร)

## 8. สำรองข้อมูลและซ้อมกู้คืน

| อะไร | Render ทำให้ | เก็บนานเท่าไร |
|---|---|---|
| ฐานข้อมูล: กู้คืนย้อนเวลา (PITR) | อัตโนมัติ | ตาม workspace plan: Hobby 3 วัน, Pro ขึ้นไป 7 วัน |
| ฐานข้อมูล: export (logical backup) | กด "Create export" หน้า Recovery | 7 วัน (ดาวน์โหลดเก็บเองได้) |
| ดิสก์ไฟล์ | snapshot อัตโนมัติวันละครั้ง | 7 วัน |

- ก่อน deploy ที่มี migration ทุกครั้ง: กด Create export ของฐานข้อมูลก่อน
- **ซ้อมกู้คืนเดือนละครั้ง** (และครั้งแรกก่อนเปิดนำร่อง)
  1. หน้า Recovery ของฐานข้อมูล → กู้คืนย้อนเวลาไปเมื่อวาน (Render สร้างฐานข้อมูล **ใหม่** ไม่ทับของเดิม)
  2. คัดลอก Internal Database URL ของฐานข้อมูลที่กู้มา แล้วใน Shell ของ `quotation-web` รัน `cd /opt/tools && node db-check.mjs "<URL ที่กู้มา>"` เทียบจำนวนแถวกับ `node db-check.mjs` (ฐานข้อมูลจริง)
  3. จดเวลาที่ใช้ แล้วลบฐานข้อมูลที่กู้มา
- กู้คืนจริง: กู้ฐานข้อมูลไปเป็นตัวใหม่ → เปลี่ยน `DATABASE_URL` ของเว็บไปที่ตัวใหม่ → ถ้าไฟล์เสียหาย กู้ snapshot ของดิสก์ในหน้า Disk (ไฟล์หลัง snapshot จะหาย)

## 9. Deploy เวอร์ชันใหม่

- ปิด auto deploy ไว้ทุกบริการ (`autoDeployTrigger: "off"`) → ตรวจ master ให้เรียบร้อย แล้วกด **Manual Deploy** นอกเวลาทำงาน
- ลำดับ: build image → pre-deploy (migration) → หยุดเวอร์ชันเก่า → เปิดเวอร์ชันใหม่ → health check
- Rollback: หน้า Deploys → Rollback ไปเวอร์ชันก่อน (migration ไม่ถูกย้อน จึงเขียน migration แบบไม่ลบคอลัมน์ที่เวอร์ชันเก่ายังใช้)

## 10. นำร่อง 1 บริษัท

1. แอดมินสร้างบริษัทนำร่อง ใส่รหัสบริษัท (ใช้ในเลขที่เอกสาร), โลโก้, ข้อมูลหัวกระดาษ และอีเมลผู้ส่ง
2. สร้างผู้ใช้ (พนักงานขาย ผู้บริหาร) ให้ผู้บริหาร/แอดมินตั้ง 2FA ให้ครบ พนักงานขายอัปโหลดลายเซ็น
3. นำเข้าลูกค้า สินค้า และวันที่ขายล่าสุดจาก Express ด้วยแม่แบบในระบบ ตรวจเวลานำเข้าไฟล์ใหญ่บนฐานข้อมูลจริง
4. ตั้งเป้ายอดขายเดือนแรก
5. อบรม 1 รอบ แล้วใช้งานจริง 2–4 สัปดาห์ เก็บปัญหาและคำขอ จากนั้นจึงเปิดใช้งานบริษัทถัดไป

## ค่า environment ทั้งหมด

| ค่า | ใครตั้ง | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | Blueprint | internal URL ของ `quotation-db` |
| `BETTER_AUTH_SECRET`, `CRON_SECRET` | Render สุ่ม | ยาว ≥ 32 ตัวอักษร |
| `APP_URL`, `BETTER_AUTH_URL` | เรา | `https://` โดเมนเดียวกัน |
| `STORAGE_DIR` | Blueprint | `/var/data/storage` (บน Render ต้องอยู่ใต้ `/var/data/` ไม่เช่นนั้นระบบไม่เริ่มทำงาน) |
| `RESEND_API_KEY`, `MAIL_FROM` | เรา | |
| `SEED_ADMIN_EMAIL` | เรา | ใช้ครั้งเดียวตอน seed |
| `CLIENT_IP_HEADER` / `TRUSTED_PROXY_HOPS` | เรา หลังขั้นที่ 6 | |
| `CHROME_PATH`, `PORT`, `NODE_ENV` | Dockerfile | ไม่ต้องตั้ง |
| `ALLOW_INCOMPLETE_ENV` | — | ใช้ทดสอบ `next start` ในเครื่องเท่านั้น **ห้ามตั้งบน Render** |
