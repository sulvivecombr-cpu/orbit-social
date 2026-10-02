"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { loginSchema, type LoginFormData } from "@/lib/utils/validators";
import { safeNext } from "@/lib/utils/post-auth-redirect";
import { createLoginEvent } from "@/lib/queries/security";
import { Button } from "@/components/ui/button";
import {
  AuthShell,
  AuthHeading,
  AuthField,
  AuthInput,
} from "@/components/auth/auth-shell";
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from "@/components/auth/turnstile-widget";

const LOCKOUT_KEY = "orbit_login_lockout";
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

interface LockoutData {
  attempts: number;
  lockedUntil: number | null;
}

function getLockoutData(): LockoutData {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { attempts: 0, lockedUntil: null };
}

function setLockoutData(data: LockoutData) {
  try {
    localStorage.setItem(LOCKOUT_KEY, JSON.stringify(data));
  } catch {}
}

function clearLockoutData() {
  try {
    localStorage.removeItem(LOCKOUT_KEY);
  } catch {}
}

// useSearchParams() must sit behind a Suspense boundary: without one, a
// client-side navigation to /login changes the URL but never renders the
// page (Next.js refuses to prerender it).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams.get("next")) ?? "/feed";
  const supabase = createClient();

  const [isLocked, setIsLocked] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [attemptsLeft, setAttemptsLeft] = useState(MAX_ATTEMPTS);

  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  // The middleware redirects half-authenticated sessions (password ok, TOTP
  // pending) back here. Resume the MFA screen instead of showing the sign-in
  // form for a user who is already past the password step.
  useEffect(() => {
    const resumePendingMfa = async () => {
      const { data: aal } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel !== "aal1" || aal?.nextLevel !== "aal2") return;
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verifiedFactor = factors?.totp.find((f) => f.status === "verified");
      if (verifiedFactor) {
        setMfaFactorId(verifiedFactor.id);
        setMfaRequired(true);
      }
    };
    resumePendingMfa();
  }, [supabase]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const checkLockout = useCallback(() => {
    const data = getLockoutData();
    if (data.lockedUntil && data.lockedUntil > Date.now()) {
      setIsLocked(true);
      setLockoutRemaining(data.lockedUntil - Date.now());
      setAttemptsLeft(0);
    } else if (data.lockedUntil && data.lockedUntil <= Date.now()) {
      clearLockoutData();
      setIsLocked(false);
      setAttemptsLeft(MAX_ATTEMPTS);
    } else {
      setAttemptsLeft(MAX_ATTEMPTS - data.attempts);
    }
  }, []);

  // Lockout state lives in localStorage, which the server render cannot read.
  // Hydrating from it has to happen after mount or the markup mismatches.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkLockout();
  }, [checkLockout]);

  useEffect(() => {
    if (!isLocked) return;
    const interval = setInterval(() => {
      const data = getLockoutData();
      if (data.lockedUntil && data.lockedUntil > Date.now()) {
        setLockoutRemaining(data.lockedUntil - Date.now());
      } else {
        clearLockoutData();
        setIsLocked(false);
        setAttemptsLeft(MAX_ATTEMPTS);
        setLockoutRemaining(0);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isLocked]);

  const recordFailedAttempt = useCallback(() => {
    const data = getLockoutData();
    data.attempts += 1;
    if (data.attempts >= MAX_ATTEMPTS) {
      data.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
      setIsLocked(true);
      setLockoutRemaining(LOCKOUT_DURATION_MS);
    }
    setLockoutData(data);
    setAttemptsLeft(MAX_ATTEMPTS - data.attempts);
  }, []);

  const formatCountdown = (ms: number) => {
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const onSubmit = async (data: LoginFormData) => {
    if (isLocked) return;

    const captchaToken = (await turnstileRef.current?.getToken()) ?? undefined;

    const { data: signInData, error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
      options: { captchaToken },
    });
    turnstileRef.current?.reset();

    if (error) {
      recordFailedAttempt();
      toast.error(error.message);
      return;
    }

    if (signInData.session && signInData.session.user) {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      if (factors && factors.totp.length > 0) {
        const verifiedFactor = factors.totp.find(
          (f) => f.status === "verified"
        );
        if (verifiedFactor) {
          setMfaRequired(true);
          setMfaFactorId(verifiedFactor.id);
          return;
        }
      }
      clearLockoutData();
      try {
        await createLoginEvent(signInData.session.user.id, "success");
      } catch {}
      try {
        await supabase.rpc("touch_last_seen");
      } catch {}
      router.push(nextPath);
      router.refresh();
    }
  };

  const handleMfaVerify = async () => {
    if (mfaCode.length !== 6 || !mfaFactorId) return;
    setMfaVerifying(true);
    try {
      const { data: challengeData, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: mfaFactorId,
        challengeId: challengeData.id,
        code: mfaCode,
      });
      if (verifyError) throw verifyError;

      clearLockoutData();
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await createLoginEvent(user.id, "success");
      } catch {}
      try {
        await supabase.rpc("touch_last_seen");
      } catch {}

      router.push(nextPath);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid verification code");
      setMfaCode("");
    } finally {
      setMfaVerifying(false);
    }
  };

  const handleRecoveryVerify = async () => {
    if (recoveryCode.trim().length < 6) return;
    setMfaVerifying(true);
    try {
      const res = await fetch("/api/auth/mfa-recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: recoveryCode }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Invalid recovery code");
      }

      // The TOTP factor was unenrolled server-side; refresh so the session
      // stops demanding aal2 before we navigate into the app.
      await supabase.auth.refreshSession();
      clearLockoutData();
      toast.success(
        "Recovery code accepted. Two-factor was removed, re-enable it in Settings.",
      );
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) await createLoginEvent(user.id, "success");
      } catch {}
      try {
        await supabase.rpc("touch_last_seen");
      } catch {}
      router.push(nextPath);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid recovery code");
      setRecoveryCode("");
    } finally {
      setMfaVerifying(false);
    }
  };

  // MFA screen
  if (mfaRequired) {
    return (
      <AuthShell>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <AuthHeading
          eyebrow="Two-factor"
          title="Verify it's"
          accent="you"
          sub={
            useRecoveryCode
              ? "Enter one of the recovery codes you saved when enabling two-factor."
              : "Enter the 6-digit code from your authenticator app."
          }
        />

        {useRecoveryCode ? (
          <>
            <div className="mt-6">
              <AuthField label="Recovery code">
                <AuthInput
                  type="text"
                  maxLength={20}
                  value={recoveryCode}
                  onChange={(e) =>
                    setRecoveryCode(
                      e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase(),
                    )
                  }
                  placeholder="XXXXXXXXXXXXXXXX"
                  className="text-center font-mono text-[16px] tracking-[0.14em]"
                  autoFocus
                />
              </AuthField>
            </div>

            <Button
              className="mt-3 h-11 w-full text-sm"
              onClick={handleRecoveryVerify}
              disabled={recoveryCode.length < 6 || mfaVerifying}
            >
              {mfaVerifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Use recovery code"
              )}
            </Button>

            <button
              type="button"
              onClick={() => {
                setUseRecoveryCode(false);
                setRecoveryCode("");
              }}
              className="mt-3.5 w-full cursor-pointer border-none bg-transparent py-2.5 text-[13px] font-medium text-primary hover:underline"
            >
              Use your authenticator app instead
            </button>
          </>
        ) : (
          <>
            <div className="mt-6">
              <AuthField label="Code">
                <AuthInput
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  className="text-center font-mono text-[22px] tracking-[0.3em]"
                  autoFocus
                />
              </AuthField>
            </div>

            <Button
              className="mt-3 h-11 w-full text-sm"
              onClick={handleMfaVerify}
              disabled={mfaCode.length !== 6 || mfaVerifying}
            >
              {mfaVerifying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Verify"
              )}
            </Button>

            <button
              type="button"
              onClick={() => setUseRecoveryCode(true)}
              className="mt-3.5 w-full cursor-pointer border-none bg-transparent py-2.5 text-[13px] font-medium text-primary hover:underline"
            >
              Lost your authenticator? Use a recovery code
            </button>
          </>
        )}

        <button
          type="button"
          onClick={async () => {
            // Drop the half-authenticated aal1 session, otherwise the
            // middleware keeps routing every page back to this screen.
            await supabase.auth.signOut();
            setMfaRequired(false);
            setMfaCode("");
            setMfaFactorId(null);
            setUseRecoveryCode(false);
            setRecoveryCode("");
          }}
          className="mt-1 w-full cursor-pointer border-none bg-transparent py-2.5 font-mono text-[12.5px] tracking-wide text-muted-foreground hover:text-foreground"
        >
          BACK TO SIGN IN
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthHeading
        eyebrow="Sign in"
        title="Welcome"
        accent="back"
        sub="Pick up where you left off."
      />

      {/* Lockout banner */}
      {isLocked && (
        <div className="mt-5 rounded-lg border border-destructive/25 bg-destructive/10 p-3.5">
          <div className="flex items-center gap-2">
            <Lock className="h-[15px] w-[15px] text-destructive" />
            <p className="text-[13px] font-semibold text-destructive">
              Account temporarily locked
            </p>
          </div>
          <p className="mt-1.5 text-xs text-destructive/80">
            Too many failed attempts. Try again in{" "}
            <span className="font-mono font-bold">
              {formatCountdown(lockoutRemaining)}
            </span>
            .
          </p>
        </div>
      )}

      {/* Attempts warning */}
      {!isLocked && attemptsLeft < MAX_ATTEMPTS && attemptsLeft > 0 && (
        <div className="mt-5 rounded-lg border border-warning/25 bg-warning/10 px-3.5 py-2 text-center font-mono text-[10.5px] tracking-[0.12em] text-warning">
          {attemptsLeft} ATTEMPT{attemptsLeft !== 1 ? "S" : ""} LEFT
        </div>
      )}

      {/* Form */}
      {/* react-hook-form's handleSubmit reads its internal control ref when
          called, which the lint rule cannot tell apart from a render-time ref
          read. The returned function only runs on submit. */}
      {/* eslint-disable-next-line react-hooks/refs */}
      <form onSubmit={handleSubmit(onSubmit)} className="mt-6">
        <AuthField label="Email" error={errors.email?.message}>
          <AuthInput
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            {...register("email")}
            disabled={isLocked}
          />
        </AuthField>

        <AuthField
          label="Password"
          error={errors.password?.message}
          hint={
            <Link
              href="/forgot-password"
              className="text-[11px] font-medium text-primary no-underline hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <AuthInput
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            {...register("password")}
            disabled={isLocked}
            suffix={
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword(!showPassword)}
                className="flex cursor-pointer items-center border-none bg-transparent p-0 text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-[15px] w-[15px]" />
                ) : (
                  <Eye className="h-[15px] w-[15px]" />
                )}
              </button>
            }
          />
        </AuthField>

        <Button
          type="submit"
          className="mt-2 h-11 w-full text-sm"
          disabled={isSubmitting || isLocked}
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Sign in"
          )}
        </Button>
        <TurnstileWidget ref={turnstileRef} />
      </form>

      {/* Footer */}
      <p className="mt-6 text-center text-[13px] text-text-secondary">
        No account?{" "}
        <Link
          href={
            nextPath !== "/feed"
              ? `/signup?next=${encodeURIComponent(nextPath)}`
              : "/signup"
          }
          className="font-semibold text-primary no-underline hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}
