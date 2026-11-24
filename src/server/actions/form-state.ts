import type { ZodError } from "zod";

/** Submitted values echoed back so a form keeps what the user typed after a failed submit. */
export type EchoedValues = Record<string, string[]>;

/** Result returned by form server actions to useActionState. Strings are translation keys. */
export type FormState =
  | {
      error?: string; // key, e.g. "users.errors.selfRemoveAdmin" or "common.genericError"
      fieldErrors?: Record<string, string>; // field → key under "validation"
      values?: EchoedValues;
      ok?: boolean;
      message?: string; // success key
    }
  | undefined;

export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "_");
    out[field] ??= issue.message;
  }
  return out;
}

/**
 * React 19 resets a <form action> after every submit. Returning the submitted values lets the
 * form use them as defaultValue again. Secrets (passwords) are never echoed.
 */
export function echoValues(formData: FormData, omit: readonly string[] = []): EchoedValues {
  const out: EchoedValues = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION") || omit.includes(key) || typeof value !== "string") continue;
    (out[key] ??= []).push(value);
  }
  return out;
}
