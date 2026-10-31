import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BadgeCheck } from 'lucide-react';
import Logo from '@/components/ui/Logo';
import Button from '@/components/ui/Button';
import GrainOverlay from '@/components/ui/GrainOverlay';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/lib/api';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { usePageMeta } from '@/hooks/usePageMeta';
import { EASE } from '@/lib/motion';
import CodeStep from './CodeStep';

const inputCls =
  'h-11 w-full rounded-card border border-line bg-white/[0.03] px-3.5 text-sm text-ink placeholder:text-faint ' +
  'outline-none transition-colors duration-micro focus:border-blue focus:bg-white/[0.05]';

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-4 last:border-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="text-right text-[14px] text-ink">{children}</dd>
    </div>
  );
}

const Verified = () => (
  <span className="ml-2 inline-flex items-center gap-1 text-[12px] text-[#7EE2A0]">
    <BadgeCheck size={14} aria-hidden /> verified
  </span>
);

// Your account: how you log in, and a phone number for logging in by text message.
export default function AccountPage() {
  useDocumentTitle('Account');
  usePageMeta({ noindex: true });
  const [account, setAccount] = useState(null);
  const [config, setConfig] = useState({ sms: false, devCodes: false });
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [verify, setVerify] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/auth/account').then(
      (r) => setAccount(r.account),
      (err) => setError(err.message),
    );
    useAuthStore.getState().config().then(setConfig);
  }, []);

  const sendCode = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setVerify((await api('/api/auth/phone', { method: 'POST', body: { phone } })).verify);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-bg">
      <GrainOverlay />
      <header className="relative z-10 flex h-20 items-center justify-between px-10">
        <Logo />
        <Link to="/join" className="text-[13px] text-muted hover:text-ink">
          Your rooms
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-6 pb-20 pt-6">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }}
          className="glass w-full max-w-[480px] rounded-[16px] p-8"
          aria-labelledby="account-title"
        >
          <h1 id="account-title" className="display mb-6 text-[40px] text-ink">
            Account
          </h1>
          {!account && !error && <p className="text-sm text-muted">Loading...</p>}
          {account && (
            <dl>
              <Row label="Name">{account.name}</Row>
              <Row label="Email">
                {account.email}
                {account.emailVerified && <Verified />}
              </Row>
              <Row label="Google">
                {account.google ? 'Linked: you can log in with Google' : 'Not linked'}
              </Row>
              <Row label="Password">
                {account.hasPassword ? 'Set' : 'None (you log in with Google or a code)'}
              </Row>
              <Row label="Phone">
                {account.phone ? (
                  <>
                    {account.phone}
                    <Verified />
                  </>
                ) : (
                  <span className="text-muted">Not added</span>
                )}
                {config.sms && !editing && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(true);
                      setPhone(account.phone || '');
                    }}
                    className="ml-3 text-[13px] text-[#9FB7FF] hover:underline"
                  >
                    {account.phone ? 'Change' : 'Add'}
                  </button>
                )}
              </Row>
            </dl>
          )}

          {editing && !verify && (
            <form
              onSubmit={sendCode}
              noValidate
              className="mt-6 space-y-4 border-t border-line pt-6"
            >
              <label htmlFor="phone" className="block text-[13px] font-medium text-ink">
                Phone number <span className="text-faint">(we text you a code to confirm it)</span>
              </label>
              <input
                id="phone"
                type="tel"
                className={inputCls}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                autoComplete="tel"
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" loading={busy} disabled={busy || !phone.trim()}>
                  Send code <ArrowRight size={15} aria-hidden />
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {verify && (
            <div className="mt-6 border-t border-line pt-6">
              <CodeStep
                key={verify.id}
                verify={verify}
                devCodes={config.devCodes}
                onVerified={(result) => {
                  setAccount(result.account);
                  setVerify(null);
                  setEditing(false);
                }}
                onBack={() => setVerify(null)}
                backLabel="Change number"
              />
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="mt-5 rounded-card border border-[#F14C4C]/30 bg-[#F14C4C]/10 px-3 py-2 text-[13px] text-[#F47174]"
            >
              {error}
            </p>
          )}
        </motion.section>
      </main>
    </div>
  );
}
