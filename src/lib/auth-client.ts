"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { ac, roles } from "@/lib/permissions";
import { hardNavigate } from "@/lib/hard-navigate";

export const authClient = createAuthClient({
  plugins: [
    adminClient({ ac, roles }),
    twoFactorClient({
      onTwoFactorRedirect() {
        hardNavigate("/login/two-factor");
      },
    }),
  ],
});
