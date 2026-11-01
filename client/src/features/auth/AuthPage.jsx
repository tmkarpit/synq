import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import HudLabel from '@/components/ui/HudLabel';
import GrainOverlay from '@/components/ui/GrainOverlay';
import { useAuthStore } from '@/store/authStore';
import { validateUsername } from '@/store/userStore';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { usePageMeta } from '@/hooks/usePageMeta';
import { EASE } from '@/lib/motion';
import { cn } from '@/lib/cn';
import GoogleButton from './GoogleButton';
import CodeStep from './CodeStep';

const inputCls =
  'h-11 w-full rounded-card border border-line bg-white/[0.03] px-3.5 text-sm text-ink placeholder:text-faint ' +
  'outline-none transition-colors duration-micro focus:border-blue focus:bg-white/[0.05]';

/** Only same-site paths, so ?next= cannot send people to another website. */
const safeNext = (next) =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : '/join';

const HEADINGS = {
  login: ['WELCOME BACK', 'Log in.', 'Pick up where you left off.'],
  signup: [
    'NEW ACCOUNT',
    'Create your account.',
    'Then create a room or join one with an invite link.',
  ],
  identify: [
    'NO PASSWORD NEEDED',
    'Log in with a code.',
    "We'll email or text you a 6-digit code.",
  ],
  code: ['CHECK YOUR INBOX', 'Enter your code.', null],
  phone: ['ONE MORE STEP', 'Verify your phone.', 'So you can also log in with a text message.'],
};

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-medium text-ink">
        {label} {hint && <span className="text-faint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

// Log in or create an account: with Google, with a password, or with a one-time code
// sent by email or SMS. New accounts confirm their email with a code first.
export default function AuthPage({ mode }) {
  const signup = mode === 'signup';
  useDocumentTitle(signup ? 'Create your account' : 'Log in');
  usePageMeta({ noindex: true });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const status = useAuthStore((s) => s.status);
  const [step, setStep] = useState('form'); // form | identify | code | phone
  const [verify, setVerify] = useState(null); // { id, channel, to, resendIn }
  const [config, setConfig] = useState({ google: null, email: true, sms: false, devCodes: false });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Asked again when the server wakes up (the first try finds nothing while it sleeps).
  const waking = useAuthStore((s) => s.waking);
  useEffect(() => {
    if (!waking) useAuthStore.getState().config().then(setConfig);
  }, [waking]);

  // Already signed in when arriving (or the server has no accounts): nothing to do here.
  // While a code step is open, that step decides where to go.
  useEffect(() => {
    if (status === 'off' || (status === 'authed' && step === 'form'))
      navigate(next, { replace: true });
  }, [status, step, next, navigate]);

  // Switching between Log in and Sign up starts over.
  useEffect(() => {
    setStep('form');
    setError(null);
    setBusy(false);
  }, [mode]);

  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  const submitForm = (e) => {
    e.preventDefault();
    if (signup) {
      const nameError = validateUsername(name);
      if (nameError) return setError(`Name: ${nameError}`);
      if (password.length < 8) return setError('Use at least 8 characters for the password.');
      return run(async () => {
        const res = await useAuthStore
          .getState()
          .signup(name.trim(), email.trim(), password, phone.trim() || undefined);
        setVerify(res.verify);
        setStep('code');
      });
    }
    return run(async () => {
      await useAuthStore.getState().login(email.trim(), password);
      navigate(next, { replace: true });
    });
  };

  const requestCode = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await useAuthStore.getState().requestCode(identifier.trim());
      setVerify(res.verify);
      setStep('code');
    });
  };

  const onGoogle = (credential) =>
    run(async () => {
      await useAuthStore.getState().google(credential);
      navigate(next, { replace: true });
    });

  const afterCode = (result) => {
    // A phone number given at sign-up gets its own code next.
    if (result.next) {
      setVerify(result.next);
      setStep('phone');
    } else navigate(next, { replace: true });
  };

  const switchTo = `${signup ? '/login' : '/signup'}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`;
  const headingKey = step === 'form' ? mode : step;
  const [hud, title, lead] = HEADINGS[headingKey];
  const codeLead =
    step === 'code' && verify?.channel === 'sms'
      ? 'Check your messages.'
      : step === 'code'
        ? 'Check your email.'
        : lead;

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <GrainOverlay />
      <div
        aria-hidden
        className="halftone pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]"
      />
      <header className="relative z-10 flex h-20 items-center justify-between px-10">
        <Logo />
        <Link to="/" className="text-[13px] text-muted hover:text-ink">
          Back to home
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-20">
        <motion.section
          key={step}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } }}
          className="glass w-full max-w-[420px] rounded-[16px] p-8 shadow-[0_40px_120px_-40px_rgba(124,92,255,0.45)]"
          aria-labelledby="auth-title"
        >
          <HudLabel index={1} accent className="mb-3">
            {hud}
          </HudLabel>
          <h1 id="auth-title" className="display mb-2 text-[40px] text-ink">
            {title}
          </h1>
          {codeLead && <p className="mb-6 text-sm text-muted">{codeLead}</p>}

          {step === 'form' && (
            <>
              <div
                role="tablist"
                aria-label="Log in or sign up"
                className="relative mb-6 grid grid-cols-2 rounded-full border border-line p-1"
              >
                {/* One pill that slides from the other tab. Not a shared layoutId: login and
                    signup are separate route elements, and a layout animation across them kept
                    the page transition from finishing. */}
                <motion.span
                  aria-hidden
                  className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-ink"
                  initial={{ x: signup ? '0%' : '100%' }}
                  animate={{ x: signup ? '100%' : '0%' }}
                  transition={{ duration: 0.35, ease: EASE }}
                />
                {[
                  ['login', 'Log in'],
                  ['signup', 'Sign up'],
                ].map(([m, label]) => (
                  <Link
                    key={m}
                    to={switchTo}
                    replace
                    onClick={(e) => m === mode && e.preventDefault()}
                    role="tab"
                    aria-selected={mode === m}
                    className={cn(
                      'relative z-10 flex h-9 items-center justify-center rounded-full text-sm font-medium transition-colors duration-micro',
                      mode === m ? 'text-bg' : 'text-muted hover:text-ink',
                    )}
                  >
                    {label}
                  </Link>
                ))}
              </div>

              <GoogleButton
                onCredential={onGoogle}
                oneTap={!signup}
                text={signup ? 'signup_with' : 'continue_with'}
              />

              <form onSubmit={submitForm} noValidate className="space-y-4">
                {signup && (
                  <Field id="name" label="Your name" hint="(shown to others in rooms)">
                    <input
                      id="name"
                      className={inputCls}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ada"
                      autoComplete="name"
                      maxLength={24}
                    />
                  </Field>
                )}
                <Field id="email" label="Email">
                  <input
                    id="email"
                    type="email"
                    className={inputCls}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@gmail.com"
                    autoComplete="email"
                    required
                  />
                </Field>
                <Field id="password" label="Password">
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      className={cn(inputCls, 'pr-11')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={signup ? 'At least 8 characters' : 'Your password'}
                      autoComplete={signup ? 'new-password' : 'current-password'}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff size={16} aria-hidden />
                      ) : (
                        <Eye size={16} aria-hidden />
                      )}
                    </button>
                  </div>
                </Field>
                {signup && config.sms && (
                  <Field id="phone" label="Phone" hint="(optional, to log in by text message)">
                    <input
                      id="phone"
                      type="tel"
                      className={inputCls}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98765 43210"
                      autoComplete="tel"
                    />
                  </Field>
                )}
                {error && <ErrorBox>{error}</ErrorBox>}
                <Button
                  type="submit"
                  size="lg"
                  className="!mt-7 w-full"
                  loading={busy}
                  disabled={busy}
                >
                  {signup ? 'Create account' : 'Log in'} <ArrowRight size={16} aria-hidden />
                </Button>
                {signup && (
                  <p className="!mt-3 text-center text-[12px] text-muted">
                    By creating an account you agree to the{' '}
                    <Link to="/terms" className="text-ink underline underline-offset-2">
                      terms
                    </Link>{' '}
                    and{' '}
                    <Link to="/privacy" className="text-ink underline underline-offset-2">
                      privacy policy
                    </Link>
                    .
                  </p>
                )}
              </form>
              {!signup && (
                <button
                  type="button"
                  onClick={() => {
                    setIdentifier(email);
                    setError(null);
                    setStep('identify');
                  }}
                  className="mt-4 w-full text-center text-[13px] text-muted hover:text-ink"
                >
                  {config.sms ? 'Email or text me a code instead' : 'Email me a code instead'}
                </button>
              )}
              <p className="mt-4 text-center text-[13px] text-muted">
                {signup ? 'Already have an account? ' : 'New to SYNQ? '}
                <Link to={switchTo} replace className="font-medium text-ink hover:underline">
                  {signup ? 'Log in' : 'Create an account'}
                </Link>
              </p>
            </>
          )}

          {step === 'identify' && (
            <form onSubmit={requestCode} noValidate className="space-y-4">
              <Field id="identifier" label={config.sms ? 'Email or phone number' : 'Email'}>
                <input
                  id="identifier"
                  className={inputCls}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={config.sms ? 'you@gmail.com or +91 98765 43210' : 'you@gmail.com'}
                  autoComplete="username"
                  autoFocus
                />
              </Field>
              {error && <ErrorBox>{error}</ErrorBox>}
              <Button
                type="submit"
                size="lg"
                className="!mt-7 w-full"
                loading={busy}
                disabled={busy || !identifier.trim()}
              >
                Send code <ArrowRight size={16} aria-hidden />
              </Button>
              <button
                type="button"
                onClick={() => setStep('form')}
                className="w-full text-center text-[13px] text-muted hover:text-ink"
              >
                Log in with a password instead
              </button>
            </form>
          )}

          {step === 'code' && verify && (
            <CodeStep
              key={verify.id}
              verify={verify}
              devCodes={config.devCodes}
              onVerified={afterCode}
              onBack={() => setStep(signup ? 'form' : 'identify')}
              backLabel={signup ? 'Change details' : 'Use another address'}
            />
          )}

          {step === 'phone' && verify && (
            <CodeStep
              key={verify.id}
              verify={verify}
              devCodes={config.devCodes}
              onVerified={() => navigate(next, { replace: true })}
              onBack={() => navigate(next, { replace: true })}
              backLabel="Skip for now"
            />
          )}
        </motion.section>
      </main>
    </div>
  );
}

function ErrorBox({ children }) {
  return (
    <p
      role="alert"
      className="rounded-card border border-[#F14C4C]/30 bg-[#F14C4C]/10 px-3 py-2 text-[13px] text-[#F47174]"
    >
      {children}
    </p>
  );
}
