// Seed: first administrator (+ optional demo data).
//   npx prisma db seed                 → admin only (if no user exists)
//   npx prisma db seed -- --demo       → admin + 3 sample companies + sample sales/executive users
// Generated passwords are written to .dev-credentials.txt (git-ignored), never to the console.

import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c TimeZone=UTC" }) });
const demo = process.argv.includes("--demo");
const CRED_FILE = ".dev-credentials.txt";

function newPassword() {
  return randomBytes(12).toString("base64url"); // 16 chars
}

async function createUser(opts: {
  name: string;
  email: string;
  role: string;
  companyId?: string;
  employeeCode?: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) return existing;
  const password = newPassword();
  const id = randomUUID();
  const user = await prisma.user.create({
    data: {
      id,
      name: opts.name,
      email: opts.email,
      emailVerified: true,
      role: opts.role,
      companyId: opts.companyId ?? null,
      employeeCode: opts.employeeCode ?? null,
      mustChangePassword: true,
      accounts: {
        create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hashPassword(password) },
      },
    },
  });
  appendFileSync(CRED_FILE, `${opts.email}\t${password}\t(${opts.role})\n`);
  return user;
}

async function main() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? "admin@example.com").trim().toLowerCase();
  if ((await prisma.user.count()) === 0) {
    appendFileSync(CRED_FILE, `# created ${new Date().toISOString()} — temporary passwords, must be changed at first sign-in\n`);
    await createUser({ name: "ผู้ดูแลระบบ", email: adminEmail, role: "admin" });
    console.log(`Created admin ${adminEmail}. Password written to ${CRED_FILE}`);
  } else {
    console.log("Users already exist — admin not created.");
  }

  if (!demo) return;

  const companies = [
    { code: "AAA", nameTh: "บริษัท ตัวอย่าง เอ จำกัด", nameEn: "Sample A Co., Ltd.", taxId: "0105500000001" },
    { code: "BBB", nameTh: "บริษัท ตัวอย่าง บี จำกัด", nameEn: "Sample B Co., Ltd.", taxId: "0105500000002" },
    { code: "CCC", nameTh: "บริษัท ตัวอย่าง ซี จำกัด", nameEn: "Sample C Co., Ltd.", taxId: "0105500000003" },
  ];
  const ids: Record<string, string> = {};
  for (const c of companies) {
    const row = await prisma.company.upsert({
      where: { code: c.code },
      update: {},
      create: { ...c, addressTh: "ที่อยู่ตัวอย่าง กรุงเทพมหานคร 10110", senderName: c.nameTh },
    });
    ids[c.code] = row.id;
  }
  await createUser({ name: "ผู้บริหาร ตัวอย่าง", email: "exec@example.com", role: "executive" });
  await createUser({ name: "พนักงานขาย หนึ่ง", email: "sales1@example.com", role: "sales", companyId: ids.AAA, employeeCode: "S001" });
  await createUser({ name: "พนักงานขาย สอง", email: "sales2@example.com", role: "sales", companyId: ids.BBB, employeeCode: "S002" });
  console.log(`Demo data ready. Passwords for new users are in ${CRED_FILE}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
