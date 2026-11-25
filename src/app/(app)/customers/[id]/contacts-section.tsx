"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { deleteContactAction, saveContactAction } from "@/server/actions/customers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, Field, FormSection } from "@/components/form";
import { FormStatus, useFieldError } from "@/components/form-status";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Contact = { id: string; name: string; position: string | null; phone: string | null; email: string | null; isPrimary: boolean };

function ContactForm({ customerId, contact, onDone }: { customerId: string; contact: Contact | null; onDone: () => void }) {
  const t = useTranslations();
  const [state, action, busy] = useActionState(saveContactAction.bind(null, customerId, contact?.id ?? null), undefined);
  const err = useFieldError(state);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  const e = state?.values;
  const val = (k: keyof Contact) => (e ? (e[k]?.[0] ?? "") : String(contact?.[k] ?? ""));

  return (
    <form action={action} className="grid gap-4">
      <Field label={t("customers.contactName")} htmlFor="c-name" error={err("name")}>
        <Input id="c-name" name="name" defaultValue={val("name")} required maxLength={120} />
      </Field>
      <Field label={t("customers.contactPosition")} htmlFor="c-position" error={err("position")}>
        <Input id="c-position" name="position" defaultValue={val("position")} maxLength={120} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("customers.contactPhone")} htmlFor="c-phone" error={err("phone")}>
          <Input id="c-phone" name="phone" type="tel" defaultValue={val("phone")} maxLength={50} />
        </Field>
        <Field label={t("customers.contactEmail")} htmlFor="c-email" error={err("email")}>
          <Input id="c-email" name="email" type="email" defaultValue={val("email")} maxLength={200} />
        </Field>
      </div>
      <CheckboxField name="isPrimary" defaultChecked={e ? e.isPrimary?.[0] === "on" : !!contact?.isPrimary} label={t("customers.primary")} />
      <FormStatus state={state} />
      <Button type="submit" disabled={busy}>{busy ? t("common.loading") : t("common.save")}</Button>
    </form>
  );
}

export function ContactsSection({ customerId, contacts, canEdit }: { customerId: string; contacts: Contact[]; canEdit: boolean }) {
  const t = useTranslations();
  const [editing, setEditing] = useState<Contact | null | undefined>(undefined); // undefined = closed, null = new
  const [deleting, startDelete] = useTransition();

  function remove(c: Contact) {
    if (!window.confirm(t("customers.deleteContactConfirm"))) return;
    startDelete(async () => {
      const res = await deleteContactAction(customerId, c.id);
      if (res?.error) toast.error(t(res.error));
    });
  }

  return (
    <FormSection title={t("customers.sectionContacts")}>
      {contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("customers.noContacts")}</p>
      ) : (
        <ul className="grid gap-2">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3 text-sm">
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {c.name} {c.isPrimary && <Badge variant="secondary" className="ml-1">{t("customers.primary")}</Badge>}
                </span>
                {c.position && <span className="text-muted-foreground">{c.position}</span>}
                <span className="text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(" · ")}</span>
              </div>
              {canEdit && (
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label={t("customers.editContact")} onClick={() => setEditing(c)}>
                    <PencilIcon />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-11 md:size-8" aria-label={t("common.delete")} disabled={deleting} onClick={() => remove(c)}>
                    <Trash2Icon />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div>
          <Button variant="outline" onClick={() => setEditing(null)}>
            <PlusIcon />
            {t("customers.addContact")}
          </Button>
        </div>
      )}
      <Dialog open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("customers.editContact") : t("customers.addContact")}</DialogTitle>
          </DialogHeader>
          {editing !== undefined && (
            <ContactForm
              key={editing?.id ?? "new"}
              customerId={customerId}
              contact={editing}
              onDone={() => {
                setEditing(undefined);

              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </FormSection>
  );
}
