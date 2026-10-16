import { useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase-client";

/**
 * DEMO MODE ONLY (`npm run demo` in Backend). One click signs in as a seeded demo user through
 * the normal Supabase sign-in, which the demo points at its local fake. Loaded by login-page.tsx
 * only in dev builds with VITE_DEMO_MODE=true; production builds do not contain it
 * (demo-login.build.test.ts checks this).
 */
// Same users as Backend/demo/users.ts. Listed here, not passed in as a VITE_ variable: Vite
// copies VITE_ variables into every bundle as data, while this file is dropped from production.
const users = [
  { email: "admin@demo.local", name: "Asha Admin", role: "admin" },
  { email: "sam@demo.local", name: "Sam Sales", role: "salesperson (both clients)" },
  { email: "priya@demo.local", name: "Priya Sales", role: "salesperson (Acme only)" },
];

export default function DemoLogin() {
  const [error, setError] = useState<string | null>(null);
  const signIn = async (email: string) => {
    setError(null);
    const result = await supabase?.auth.signInWithPassword({ email, password: "demo" });
    if (result?.error) setError(result.error.message);
  };
  return (
    <div data-demo-login className="mt-4 space-y-2 rounded-lg border border-dashed bg-card p-4">
      <p className="text-xs font-medium">Demo users (local demo data only)</p>
      {users.map((u) => (
        <Button
          key={u.email}
          variant="outline"
          className="w-full justify-between"
          onClick={() => void signIn(u.email)}
        >
          <span>{u.name}</span>
          <span className="text-xs text-muted-foreground">{u.role}</span>
        </Button>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
