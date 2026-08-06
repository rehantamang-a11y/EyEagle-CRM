import { ProtectedApp } from "@/components/auth/protected-app";
import { CRMApp } from "@/components/crm-app";
export default function Page() { return <ProtectedApp><CRMApp /></ProtectedApp>; }
