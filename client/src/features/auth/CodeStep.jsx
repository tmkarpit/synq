import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';

/**
 * Enter the 6-digit code that was emailed or texted. Submits by itself at 6 digits,
 * and offers a new code after the server's cooldown.
 *   verify: { id, channel: 'email' | 'sms', to, resendIn }
 *   onVerified(result): what POST /api/auth/verify answered
 */
export default function CodeStep({
  verify,
  onVerified,
  onBack,
  backLabel = 'Back',
  devCodes = false,
  extra = null,
}) {
  const [current, setCurrent] = useState(verify);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(verify.resendIn ?? 60);
  const inputRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), [current]);
  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (value = code) => {
    if (busy || value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      onVerified(await useAuthStore.getState().verify(current.id, value));
    } catch (err) {
      setError(err.message);
      setCode('');
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const resend = async () => {
    setError(null);
    try {
      const { verify: fresh } = await useAuthStore.getState().resend(current.id);
      setCurrent(fresh);
      setWait(fresh.resendIn ?? 60);
      setInfo('A new code is on its way.');
    } catch (err) {
      setError(err.message);
      if (err.retryIn) setWait(err.retryIn);
    }
  };

  const where = current.channel === 'sms' ? 'texted' : 'emailed';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <p className="mb-5 text-sm text-muted">
        We {where} a 6-digit code to <span className="font-medium text-ink">{current.to}</span>. It
        works for 10 minutes.
      </p>
      <label htmlFor="otp" className="mb-2 block text-[13px] font-medium text-ink">
        Verification code
      </label>
      <input
        ref={inputRef}
        id="otp"
        value={code}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) submit(digits);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        maxLength={6}
        aria-describedby={error ? 'otp-error' : undefined}
        className="h-14 w-full rounded-card border border-line bg-white/[0.03] text-center font-mono text-[26px] tracking-[0.5em] text-ink placeholder:text-faint/50 outline-none transition-colors duration-micro focus:border-blue focus:bg-white/[0.05]"
      />
      {devCodes && (
        <p className="mt-2 text-[12px] text-faint">
          Development mode: the code is printed in the SYNQ server window.
        </p>
      )}
      {error && (
        <p
          id="otp-error"
          role="alert"
          className="mt-4 rounded-card border border-[#F14C4C]/30 bg-[#F14C4C]/10 px-3 py-2 text-[13px] text-[#F47174]"
        >
          {error}
        </p>
      )}
      {info && !error && <p className="mt-3 text-[13px] text-[#7EE2A0]">{info}</p>}
      <Button
        type="submit"
        size="lg"
        className="mt-6 w-full"
        loading={busy}
        disabled={busy || code.length !== 6}
      >
        Verify <ArrowRight size={16} aria-hidden />
      </Button>
      <div className="mt-5 flex items-center justify-between text-[13px]">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 text-muted hover:text-ink"
          >
            <ArrowLeft size={14} aria-hidden /> {backLabel}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={resend}
          disabled={wait > 0}
          className="text-muted hover:text-ink disabled:cursor-default disabled:opacity-50"
        >
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
      </div>
      {extra}
    </form>
  );
}
