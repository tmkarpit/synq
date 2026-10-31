import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

const GSI_SRC = 'https://accounts.google.com/gsi/client';
let gsiPromise = null;

/** Loads Google Identity Services once. */
function loadGsi() {
  gsiPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI_SRC;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      gsiPromise = null;
      reject(new Error('Google sign-in could not load. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return gsiPromise;
}

/**
 * Google's "Continue with Google" button (and, with oneTap, the one-click prompt in the
 * corner). Renders nothing until the server has a Google client id. The credential it
 * hands over is a Google ID token; the server checks it.
 */
export default function GoogleButton({ onCredential, oneTap = false, text = 'continue_with' }) {
  const ref = useRef(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [clientId, setClientId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    useAuthStore
      .getState()
      .config()
      .then((c) => active && setClientId(c.google));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!clientId) return undefined;
    let cancelled = false;
    loadGsi()
      .then((google) => {
        if (cancelled || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => callback.current(credential),
          ux_mode: 'popup',
          use_fedcm_for_prompt: true,
          cancel_on_tap_outside: true,
        });
        google.accounts.id.renderButton(ref.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'center',
          width: Math.min(ref.current.offsetWidth || 356, 400),
        });
        if (oneTap) google.accounts.id.prompt();
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
      window.google?.accounts?.id?.cancel?.();
    };
  }, [clientId, oneTap, text]);

  if (!clientId) return null;
  return (
    <div className="mb-5">
      <div ref={ref} className="flex min-h-[44px] w-full justify-center" />
      {error && <p className="mt-2 text-center text-[12px] text-[#F47174]">{error}</p>}
      <div className="mt-5 flex items-center gap-3 text-[12px] text-faint">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
