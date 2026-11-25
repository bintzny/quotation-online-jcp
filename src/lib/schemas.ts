import { z } from "zod";

// Shared validation. Error messages are translation keys under "validation" / "auth" / "users".

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max = 500) =>
  z.preprocess(emptyToUndefined, z.string().trim().max(max, "tooLong").optional());

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "required"),
    newPassword: z.string().min(10, "passwordTooShort").max(128, "tooLong"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "passwordMismatch",
  })
  .refine((d) => d.newPassword !== d.currentPassword, {
    path: ["newPassword"],
    message: "passwordSameAsCurrent",
  });

const roleList = z
  .array(z.enum(["sales", "executive", "admin"]))
  .min(1, "rolesRequired");

const userBase = {
  name: z.string().trim().min(1, "required").max(120, "tooLong"),
  email: z.string().trim().toLowerCase().email("email").max(200, "tooLong"),
  phone: optionalText(30),
  employeeCode: z.preprocess(emptyToUndefined, z.string().trim().toUpperCase().max(30, "tooLong").optional()),
  roles: roleList,
  companyId: z.preprocess(emptyToUndefined, z.string().optional()),
  extraCompanyIds: z.array(z.string()).default([]),
};

function salesNeedsCompany<T extends { roles: string[]; companyId?: string }>(d: T) {
  return !d.roles.includes("sales") || !!d.companyId;
}

export const createUserSchema = z
  .object({
    ...userBase,
    tempPassword: z.string().min(10, "passwordTooShort").max(128, "tooLong"),
  })
  .refine(salesNeedsCompany, { path: ["companyId"], message: "companyRequired" });

export const updateUserSchema = z
  .object(userBase)
  .refine(salesNeedsCompany, { path: ["companyId"], message: "companyRequired" });

export const resetUserPasswordSchema = z.object({
  tempPassword: z.string().min(10, "passwordTooShort").max(128, "tooLong"),
});

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

export const companySchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}$/, "companyCode"),
  nameTh: z.string().trim().min(1, "required").max(200, "tooLong"),
  nameEn: optionalText(200),
  taxId: z.string().trim().regex(/^\d{13}$/, "taxId"),
  branchCode: z.string().trim().regex(/^\d{5}$/, "branchCode"),
  addressTh: z.string().trim().min(1, "required").max(1000, "tooLong"),
  addressEn: optionalText(1000),
  phone: optionalText(50),
  email: z.preprocess(emptyToUndefined, z.string().trim().email("email").max(200, "tooLong").optional()),
  website: optionalText(200),
  vatRegistered: checkbox,
  vatRate: z.coerce.number({ message: "number" }).min(0, "number").max(100, "number"),
  defaultValidityDays: z.coerce.number({ message: "number" }).int("number").min(1, "number").max(365, "number"),
  quoteTermsTh: optionalText(4000),
  quoteTermsEn: optionalText(4000),
  senderEmail: z.preprocess(emptyToUndefined, z.string().trim().email("email").max(200, "tooLong").optional()),
  senderName: optionalText(200),
  active: checkbox,
});

export type CompanyInput = z.infer<typeof companySchema>;

// ── Customers ──

const optionalEmail = z.preprocess(emptyToUndefined, z.string().trim().email("email").max(200, "tooLong").optional());

export const customerSchema = z
  .object({
    type: z.enum(["JURISTIC", "INDIVIDUAL"], { message: "customerType" }),
    name: z.string().trim().min(1, "required").max(200, "tooLong"),
    taxId: z.preprocess(
      (v) => (typeof v === "string" ? v.replace(/[\s-]/g, "") : v),
      z.preprocess(emptyToUndefined, z.string().regex(/^\d{13}$/, "taxId").optional()),
    ),
    // Individuals have no branch field in the form: absent or empty means head office.
    branchCode: z.preprocess(
      (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? "00000" : v),
      z.string().trim().regex(/^\d{5}$/, "branchCode"),
    ),
    branchName: optionalText(120),
    address: z.string().trim().min(1, "required").max(1000, "tooLong"),
    phone: optionalText(50),
    email: optionalEmail,
    creditDays: z.coerce.number({ message: "number" }).int("number").min(0, "number").max(365, "number"),
    note: optionalText(2000),
    // managers may choose the owner when creating; ignored for sales
    ownerId: z.preprocess(emptyToUndefined, z.string().optional()),
    // individuals that look like an existing customer need explicit confirmation
    confirmNotDuplicate: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  })
  .refine((d) => d.type !== "JURISTIC" || !!d.taxId, { path: ["taxId"], message: "taxIdRequired" });

export type CustomerInput = z.infer<typeof customerSchema>;

export const contactSchema = z
  .object({
    name: z.string().trim().min(1, "required").max(120, "tooLong"),
    position: optionalText(120),
    phone: optionalText(50),
    email: optionalEmail,
    isPrimary: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  });

export const changeOwnerSchema = z.object({
  ownerId: z.preprocess(emptyToUndefined, z.string().optional()),
  note: optionalText(500),
});

// ── Products ──

export const productSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._/-]*$/, "productCode").max(40, "tooLong"),
    name: z.string().trim().min(1, "required").max(200, "tooLong"),
    nameEn: optionalText(200),
    category: optionalText(60),
    unit: z.string().trim().min(1, "required").max(30, "tooLong"),
    listPrice: z.string().trim().min(1, "required"),
    minPrice: z.string().trim().optional().default(""),
    isService: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
    active: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
    description: optionalText(2000),
  });

// ── Quotations ──
// The editor sends one JSON payload. Amounts arrive as the text people typed and are parsed on
// the server (parseQuantity / parseBahtToSatang / parsePercent); totals are always recomputed.

const discountInput = z.object({
  type: z.enum(["NONE", "PERCENT", "AMOUNT"]),
  value: z.string().trim().max(20).default(""),
});

export const quotationLineSchema = z.object({
  productId: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
  name: z.string().trim().max(300, "tooLong").default(""), // custom lines only
  unit: z.string().trim().max(30, "tooLong").default(""), // custom lines only
  quantity: z.string().trim().max(20),
  unitPrice: z.string().trim().max(20),
  discount: discountInput,
});

export const quotationPayloadSchema = z.object({
  companyId: z.string().min(1, "required").max(40),
  customerId: z.string().min(1, "required").max(40),
  contactId: z.preprocess(emptyToUndefined, z.string().max(40).optional()),
  validityDays: z.coerce.number({ message: "number" }).int("number").min(1, "number").max(365, "number"),
  creditDays: z.coerce.number({ message: "number" }).int("number").min(0, "number").max(365, "number"),
  note: optionalText(2000),
  terms: optionalText(4000),
  billDiscount: discountInput,
  pdfLanguage: z.enum(["TH", "EN"]).default("TH"),
  items: z.array(quotationLineSchema).min(1, "itemsRequired").max(100, "tooManyItems"),
  version: z.coerce.number().int().optional(), // edits: the version the editor loaded
});

export type QuotationPayload = z.infer<typeof quotationPayloadSchema>;
export type QuotationLinePayload = z.infer<typeof quotationLineSchema>;

/** "a@x.com, b@y.com; c@z.com" → unique, lower-cased addresses. */
const emailList = (max: number, required: boolean) =>
  z.preprocess(
    (v) => (typeof v === "string" ? [...new Set(v.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))] : v),
    z.array(z.string().email("emailList").max(200, "tooLong")).min(required ? 1 : 0, "required").max(max, "tooManyRecipients"),
  );

export const quotationEmailSchema = z.object({
  to: emailList(5, true),
  cc: emailList(5, false),
  ccMe: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
  message: optionalText(2000),
});

// ── M5: follow-ups and closing ──

const dateOnly = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "date");

export const followupSchema = z.object({
  contactedOn: dateOnly,
  channel: z.enum(["PHONE", "LINE", "VISIT", "EMAIL", "OTHER"], { message: "required" }),
  detail: z.string().trim().min(1, "required").max(2000, "tooLong"),
  nextDate: z.preprocess(emptyToUndefined, dateOnly.optional()),
  // customer-level contact with an inactive customer (M6)
  outcome: z.preprocess(emptyToUndefined, z.enum(["STILL_CUSTOMER", "CLOSED_BUSINESS", "COMPETITOR", "OTHER"]).optional()),
});

// ── Inactive customers and transfers (M6) ──

export const transferRequestSchema = z.object({
  reason: z.string().trim().min(1, "required").max(500, "tooLong"),
});

export const transferDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"], { message: "required" }),
  note: optionalText(500),
});

export const transferSchema = z.object({
  toUserId: z.string().trim().min(1, "required").max(100),
  note: optionalText(500),
});

export const dormantMonthsSchema = z.object({
  months: z.coerce.number({ message: "dormantMonths" }).int("dormantMonths").min(1, "dormantMonths").max(36, "dormantMonths"),
});

export const wonSchema = z.object({
  poNumber: z.string().trim().min(1, "required").max(50, "tooLong"),
  poDate: dateOnly,
});

export const lostSchema = z
  .object({
    reason: z.enum(["PRICE", "COMPETITOR", "NO_BUDGET", "OTHER"], { message: "required" }),
    note: optionalText(500),
  })
  .refine((v) => v.reason !== "OTHER" || !!v.note, { path: ["note"], message: "lostNoteRequired" });
