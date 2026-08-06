import { Suspense } from "react";
import { LoginRoute } from "@/components/auth/login-route";
import { AuthLoadingScreen } from "@/components/auth/auth-loading-screen";

export default function LoginPage() {
  return <Suspense fallback={<AuthLoadingScreen />}><LoginRoute /></Suspense>;
}
