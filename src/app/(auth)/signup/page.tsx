"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Eye,
  EyeOff,
  Loader2,
  Check,
  X,
  ArrowLeft,
  ArrowRight,
  User,
  Shield,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fullSignUpSchema, type FullSignUpFormData } from "@/lib/utils/validators";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { setPendingRedirect } from "@/lib/utils/post-auth-redirect";

const stepLabels = ["ACCOUNT", "SECURITY", "PROFILE"] as const;

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "10+ chars", met: password.length >= 10 },
    { label: "Uppercase", met: /[A-Z]/.test(password) },
    { label: "Lowercase", met: /[a-z]/.test(password) },
    { label: "Number", met: /[0-9]/.test(password) },
    { label: "Symbol", met: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
  ];
  if (!password) return null;
  const metCount = checks.filter((c) => c.met).length;
  const pct = (metCount / checks.length) * 100;
  const barColor =
    pct <= 40 ? "bg-destructive" : pct <= 70 ? "bg-warning" : "bg-success";

  return (
    <div className="mt-2.5">
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {checks.map((c) => (
          <span
            key={c.label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] font-mono text-[10.5px] tracking-[0.04em] ${
              c.met
                ? "border-success/25 bg-success/10 text-success"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            {c.met ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
            {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function StepPills({ current }: { current: number }) {
  return (
    <div className="mt-4 flex items-center justify-center gap-2.5">
      {stepLabels.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2.5">
            {i > 0 && (
              <div
                className={`h-px w-[22px] ${done ? "bg-primary" : "bg-border"}`}
              />
            )}
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-[5px] font-mono text-[10px] font-bold tracking-[0.12em] ${
                active || done
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground"
              }`}
            >
              <span>{i + 1}</span>
              <span>{label}</span>
              {done && <Check className="h-2.5 w-2.5" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// useSearchParams() must sit behind a Suspense boundary: without one, a
// client-side navigation to /signup changes the URL but never renders the
// page (Next.js refuses to prerender it).
export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const [currentStep, setCurrentStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [dobMonth, setDobMonth] = useState("");
  const [dobDay, setDobDay] = useState("");
  const [dobYear, setDobYear] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FullSignUpFormData>({
    resolver: zodResolver(fullSignUpSchema),
    defaultValues: {
      fullName: "",
      username: "",
      email: "",
      dateOfBirth: "",
      password: "",
      confirmPassword: "",
      bio: "",
      agreeToTerms: false,
    },
  });

  const passwordValue = watch("password", "");
  const fullNameValue = watch("fullName", "");
  const usernameValue = watch("username", "");
  const agreeToTerms = watch("agreeToTerms");

  const updateDob = (month: string, day: string, year: string) => {
    const m = month.replace(/\D/g, "");
    const d = day.replace(/\D/g, "");
    const y = year.replace(/\D/g, "");
    if (m.length >= 1 && d.length >= 1 && y.length === 4) {
      setValue("dateOfBirth", `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, { shouldValidate: true });
    } else {
      setValue("dateOfBirth", "", { shouldValidate: false });
    }
  };

  useEffect(() => {
    if (fullNameValue && !usernameValue) {
      const generated = fullNameValue
        .toLowerCase()
        .replace(/[^a-z0-9\s_]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 30);
      if (generated.length >= 3) setValue("username", generated);
    }
  }, [fullNameValue, setValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkUsername = useCallback(
    async (username: string) => {
      if (!username || username.length < 3) {
        setUsernameAvailable(null);
        return;
      }
      setCheckingUsername(true);
      const { data } = await supabase
        .from("profiles")
        .select("username")
        .eq("username", username.toLowerCase())
        .maybeSingle();
      setUsernameAvailable(!data);
      setCheckingUsername(false);
    },
    [supabase]
  );

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (usernameValue && usernameValue.length >= 3) {
        checkUsername(usernameValue);
      } else {
        setUsernameAvailable(null);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [usernameValue, checkUsername]);

  const step1Fields: (keyof FullSignUpFormData)[] = ["fullName", "username", "email", "dateOfBirth"];
  const step2Fields: (keyof FullSignUpFormData)[] = ["password", "confirmPassword"];

  const goNext = async () => {
    const fieldsToValidate = currentStep === 0 ? step1Fields : step2Fields;
    const isValid = await trigger(fieldsToValidate);
    if (!isValid) return;
    if (currentStep === 0 && usernameAvailable === false) {
      toast.error("That username is taken");
      return;
    }
    setCurrentStep((s) => Math.min(s + 1, 2));
  };

  const goBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  const handleAvatarSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      toast.error("File must be JPEG, PNG, WebP, or GIF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setAvatarPreview(URL.createObjectURL(file));
    (window as unknown as { __pendingAvatarFile?: File }).__pendingAvatarFile = file;
  };

  const onSubmit = async (data: FullSignUpFormData) => {
    // Persist the deep-link the visitor came from so onboarding can return
    // them to it after the email-verification round-trip.
    setPendingRedirect(searchParams.get("next"));

    const captchaToken = (await turnstileRef.current?.getToken()) ?? undefined;

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/callback?next=/feed`,
        captchaToken,
        data: {
          full_name: data.fullName,
          username: data.username.toLowerCase(),
          bio: data.bio || null,
        },
      },
    });
    turnstileRef.current?.reset();
    if (error) {
      toast.error(error.message);
      return;
    }
    router.push(`/verify-email?email=${encodeURIComponent(data.email)}`);
  };

  return (
    <AuthShell>
      <AuthHeading
        eyebrow="Create account"
        title="Join the"
        accent="orbit"
        sub="Small places. People you actually like."
      />

      <StepPills current={currentStep} />

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6">
        <div className="relative min-h-[340px]">
          {currentStep === 0 && (
            <div>
              <AuthField label="Display name" error={errors.fullName?.message}>
                <AuthInput
                  type="text"
                  placeholder="How others will see you"
                  {...register("fullName")}
                />
              </AuthField>

              <AuthField
                label="Username"
                error={
                  errors.username?.message ||
                  (usernameAvailable === false ? "That handle is taken" : undefined)
                }
              >
                <AuthInput
                  type="text"
                  placeholder="username"
                  prefix={<span>@</span>}
                  {...register("username")}
                  suffix={
                    checkingUsername ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : usernameAvailable === true && usernameValue.length >= 3 ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : usernameAvailable === false ? (
                      <X className="h-3.5 w-3.5 text-destructive" />
                    ) : null
                  }
                />
              </AuthField>

              <AuthField label="Email address" error={errors.email?.message}>
                <AuthInput
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  {...register("email")}
                />
              </AuthField>

              <AuthField label="Date of birth" error={errors.dateOfBirth?.message} hint="Must be at least 13">
                <div className="grid grid-cols-[1fr_1fr_1.3fr] gap-2">
                  <AuthInput
                    type="text"
                    inputMode="numeric"
                    placeholder="MM"
                    maxLength={2}
                    value={dobMonth}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                      setDobMonth(v);
                      updateDob(v, dobDay, dobYear);
                    }}
                    className="text-center"
                  />
                  <AuthInput
                    type="text"
                    inputMode="numeric"
                    placeholder="DD"
                    maxLength={2}
                    value={dobDay}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                      setDobDay(v);
                      updateDob(dobMonth, v, dobYear);
                    }}
                    className="text-center"
                  />
                  <AuthInput
                    type="text"
                    inputMode="numeric"
                    placeholder="YYYY"
                    maxLength={4}
                    value={dobYear}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setDobYear(v);
                      updateDob(dobMonth, dobDay, v);
                    }}
                    className="text-center"
                  />
                </div>
                <input type="hidden" {...register("dateOfBirth")} />
              </AuthField>
            </div>
          )}

          {currentStep === 1 && (
            <div>
              <div className="mb-4 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                  <Shield className="h-[22px] w-[22px]" />
                </div>
                <p className="text-[13px] text-text-secondary">
                  Pick a password you&apos;ll remember. Long beats clever.
                </p>
              </div>

              <AuthField label="Password" error={errors.password?.message}>
                <AuthInput
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Create a strong password"
                  {...register("password")}
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
              <PasswordStrength password={passwordValue} />

              <div className="mt-4">
                <AuthField label="Confirm password" error={errors.confirmPassword?.message}>
                  <AuthInput
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                    {...register("confirmPassword")}
                    suffix={
                      <button
                        type="button"
                        aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="flex cursor-pointer items-center border-none bg-transparent p-0 text-muted-foreground hover:text-foreground"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-[15px] w-[15px]" />
                        ) : (
                          <Eye className="h-[15px] w-[15px]" />
                        )}
                      </button>
                    }
                  />
                </AuthField>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <div className="mb-4 text-center">
                <p className="text-[13px] text-text-secondary">
                  Almost in. Add a face and a line.
                </p>
              </div>

              <div className="flex justify-center">
                <div
                  onClick={() => avatarInputRef.current?.click()}
                  className="relative cursor-pointer"
                >
                  <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-border bg-muted">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-9 w-9 text-muted-foreground" />
                    )}
                  </div>
                  <div className="absolute -bottom-1 -right-1 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Camera className="h-3 w-3" />
                  </div>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleAvatarSelect}
                  className="hidden"
                />
              </div>
              <p className="mb-5 mt-2 text-center font-mono text-[11px] tracking-[0.08em] text-muted-foreground">
                TAP TO ADD A PHOTO
              </p>

              <AuthField
                label="Bio"
                hint="Optional"
                error={errors.bio?.message}
              >
                <Textarea
                  placeholder="Tell us about yourself…"
                  {...register("bio")}
                  rows={3}
                  maxLength={160}
                />
              </AuthField>

              <label className="mt-2 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  {...register("agreeToTerms")}
                  className="mt-[3px] h-4 w-4 accent-primary"
                />
                <span className="text-xs leading-normal text-text-secondary">
                  I agree to the{" "}
                  <Link
                    href="/terms"
                    target="_blank"
                    className="font-medium text-primary hover:underline"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    target="_blank"
                    className="font-medium text-primary hover:underline"
                  >
                    Privacy Policy
                  </Link>
                  .
                </span>
              </label>
              {errors.agreeToTerms && (
                <p className="mt-1.5 text-[11px] text-destructive">
                  {errors.agreeToTerms.message}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex gap-2.5">
          {currentStep > 0 && (
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 text-sm"
              onClick={goBack}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          )}
          {currentStep < 2 ? (
            <Button
              type="button"
              className={currentStep === 0 ? "h-11 w-full text-sm" : "h-11 flex-1 text-sm"}
              onClick={goNext}
            >
              Next
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="submit"
              className="h-11 flex-1 text-sm"
              disabled={isSubmitting || !agreeToTerms}
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create account"
              )}
            </Button>
          )}
        </div>
        <TurnstileWidget ref={turnstileRef} />
      </form>

      <p className="mt-6 text-center text-[13px] text-text-secondary">
        Already have an account?{" "}
        <Link
          href={
            searchParams.get("next")
              ? `/login?next=${encodeURIComponent(searchParams.get("next")!)}`
              : "/login"
          }
          className="font-semibold text-primary no-underline hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
