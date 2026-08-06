import type { ReactNode } from "react";
import { ProtectedApp } from "@/components/auth/protected-app";
import { CrmShell } from "@/components/crm/crm-shell";

export default function CrmLayout({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  return <ProtectedApp><CrmShell modal={modal}>{children}</CrmShell></ProtectedApp>;
}
