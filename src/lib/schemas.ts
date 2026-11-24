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
