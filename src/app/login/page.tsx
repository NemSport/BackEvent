"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(supabase ? null : "Mock mode");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const validationError = validate(mode, fullName, email, password);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!supabase) {
      router.replace("/");
      return;
    }

    setLoading(true);

    try {
      if (mode === "login") {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });

        if (loginError) {
          throw loginError;
        }

        router.replace("/");
        return;
      }

      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });

      if (signupError) {
        throw signupError;
      }

      if (data.session) {
        await ensureProfile(data.user?.id, fullName);
        router.replace("/");
        return;
      }

      setMessage("Tjek din mail for bekræftelse");
    } catch (caughtError) {
      console.error("BackEvent login/signup failed", caughtError);
      setError(mode === "login" ? "Kunne ikke logge ind" : "Kunne ikke oprette bruger");
    } finally {
      setLoading(false);
    }
  }

  async function ensureProfile(userId: string | undefined, name: string) {
    if (!supabase || !userId) {
      return;
    }

    const { error: profileError } = await supabase.from("backevent_profiles").upsert({
      id: userId,
      full_name: name,
      role: "frivillig",
      active: true,
    });

    if (profileError) {
      console.warn("BackEvent profile upsert skipped", profileError);
    }
  }

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setMessage(supabase ? null : "Mock mode");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <section className="w-full max-w-md rounded-[2rem] bg-macro p-6 shadow-soft">
        <div className="mb-6 rounded-[1.75rem] bg-pantone139 p-5">
          <h1 className="text-4xl font-bold text-ink">BackEvent</h1>
          <p className="mt-2 text-lg font-medium text-pantone140">
            {mode === "login" ? "Log ind for at fortsætte" : "Opret bruger"}
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-soft p-2">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`min-h-12 rounded-xl px-3 py-2 text-base font-bold ${
              mode === "login" ? "bg-pantone140 text-white" : "text-pantone140"
            }`}
          >
            Log ind
          </button>
          <button
            type="button"
            onClick={() => switchMode("signup")}
            className={`min-h-12 rounded-xl px-3 py-2 text-base font-bold ${
              mode === "signup" ? "bg-pantone140 text-white" : "text-pantone140"
            }`}
          >
            Opret bruger
          </button>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <Field label="Fulde navn" value={fullName} onChange={setFullName} autoComplete="name" />
          ) : null}
          <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="email" />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />

          {error ? <p className="rounded-2xl bg-warmRed/10 px-4 py-3 text-base font-bold text-warmRed">{error}</p> : null}
          {message ? <p className="rounded-2xl bg-soft px-4 py-3 text-base font-bold text-pantone140">{message}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className="min-h-14 w-full rounded-2xl bg-pantone139 px-5 py-4 text-lg font-bold text-ink shadow-soft disabled:opacity-50"
          >
            {loading ? (mode === "login" ? "Logger ind..." : "Opretter...") : mode === "login" ? "Log ind" : "Opret bruger"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => switchMode(mode === "login" ? "signup" : "login")}
          className="mt-5 min-h-12 w-full rounded-2xl border border-line bg-macro px-4 py-3 text-base font-bold text-pantone140"
        >
          {mode === "login" ? "Opret ny bruger" : "Har du allerede bruger? Log ind"}
        </button>

      </section>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="text-lg font-bold text-ink">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        autoComplete={autoComplete}
        className="mt-2 min-h-14 w-full rounded-2xl border border-line bg-macro px-4 py-3 text-lg font-bold text-ink outline-none focus:border-pantone140"
      />
    </label>
  );
}

function validate(mode: Mode, fullName: string, email: string, password: string) {
  if (mode === "signup" && !fullName.trim()) {
    return "Udfyld navn";
  }

  if (!email.trim()) {
    return "Udfyld email";
  }

  if (!password) {
    return "Udfyld adgangskode";
  }

  return null;
}
