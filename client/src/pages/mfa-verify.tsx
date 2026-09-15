import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MfaCodeForm } from "@/components/mfa";

/**
 * Where Google sign-in lands for an account with 2FA on: the Google step is
 * done, the code step isn't, and there's no session until it is.
 */
export default function MfaVerifyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle className="text-lg">Finish signing in</CardTitle></CardHeader>
        <CardContent>
          <MfaCodeForm onVerified={() => { window.location.href = "/"; }} onRestart={() => { window.location.href = "/"; }} />
        </CardContent>
      </Card>
    </div>
  );
}
