import { useState, type FormEvent } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase-client";

/**
 * Real Supabase Auth sign-in. There is no self-service sign-up form here on
 * purpose — the migration (SECTION 3) provisions a profile automatically
 * whenever a Supabase Auth user is created, but who's allowed to create one
 * is a Supabase dashboard / invite-flow decision, not something this MVP's
 * frontend should offer (see product brief: no invitation management, no
 * self-service admin UI in this phase).
 */
export function LoginPage({ adminMode = false }: { adminMode?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) setError(signInError.message);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
      <a
        href={adminMode ? "/" : "/admin"}
        className="absolute right-5 top-5 rounded-md border bg-card px-3 py-2 text-xs font-medium shadow-sm hover:bg-accent"
      >
        {adminMode ? "Sales Login" : "Admin Login"}
      </a>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="grid size-9 place-items-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="text-lg font-semibold">MOTM Flow{adminMode ? " Admin" : ""}</div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-6 shadow-sm">
          <div>
            <Label htmlFor="email" className="mb-1.5 block text-xs">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div>
            <Label htmlFor="password" className="mb-1.5 block text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Accounts are provisioned by your administrator — there is no self-service sign-up.
          </p>
        </form>
      </div>
    </div>
  );
}
