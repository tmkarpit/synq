import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LogoMark } from '@/components/ui/Logo';
import HudLabel from '@/components/ui/HudLabel';
import { APP } from '@/config/app';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { usePageMeta } from '@/hooks/usePageMeta';

// What SYNQ stores and the rules for using it. Keep this in step with the server:
// accounts.js (users, login_history), otp.js, github.js, mongoStore.js (rooms).
const UPDATED = '2 November 2026';

const PRIVACY = {
  title: 'Privacy policy',
  description: 'What SYNQ stores about you, why, how long it is kept, and how to have it deleted.',
  sections: [
    [
      'What we store',
      [
        'Your account: name, email address, a hashed password (never the password itself), and a phone number if you add one. If you use "Continue with Google", the Google account id that links it.',
        'Login history: the time, the way you signed in (password, code or Google), your IP address and browser for every signup, login, failed login and logout. It protects your account and is deleted automatically after one year.',
        'Login sessions: a random token in a cookie, stored on our side only as a hash. It expires after 30 days or when you log out.',
        'Verification codes: stored as hashes and deleted automatically after a day.',
        'Rooms: the files you and your collaborators write, the room name, who the members are and their roles. Room chat is not stored; it disappears when everyone leaves.',
        'GitHub: if you connect GitHub to push code, your token is stored encrypted and is used only when you press Push.',
      ],
    ],
    [
      'What we do not do',
      [
        'No advertising, no tracking or analytics scripts, and we do not sell or share your data.',
        'The only cookie is the login cookie. Your editor preferences stay in your own browser (local storage).',
      ],
    ],
    [
      'Services that handle your data',
      [
        'Email codes are sent through our email provider; SMS codes through Twilio, when enabled.',
        'Google, when you choose "Continue with Google".',
        'GitHub, only when you push a room to your own repository.',
        'The database and server host that run SYNQ.',
      ],
    ],
    [
      'Who can see what',
      [
        'Everyone you admit to a room sees its files, your name, cursor and chat messages in it. The room owner sees the members and pending requests.',
        'Code you run (JavaScript and TypeScript) executes in a sandbox on the SYNQ server; it is not sent to any other service. Everyone in the room sees the output.',
      ],
    ],
    [
      'Your choices',
      [
        'You can change your details on the Account page and disconnect GitHub at any time.',
        `To have your account and its data deleted, contact ${APP.author.name} through GitHub (link below). Rooms you own are deleted with it; rooms owned by others keep the code you wrote there.`,
      ],
    ],
  ],
};

const TERMS = {
  title: 'Terms of use',
  description: 'The rules for using SYNQ, the real-time collaborative code editor.',
  sections: [
    [
      'Using SYNQ',
      [
        'SYNQ is a free service for writing and running code together. You need an account to create or join rooms, and you are responsible for what happens under it.',
        'Keep your password and login codes to yourself.',
      ],
    ],
    [
      'Your code',
      [
        'The code you write stays yours. You give SYNQ permission to store it, show it to the people in your room and run it when someone in the room asks.',
        'Only invite people you trust: members can edit, run and download everything in the room.',
      ],
    ],
    [
      'Not allowed',
      [
        'Attacking the service or other people: malware, trying to break out of the code runner, scanning or flooding networks, mining, or anything that overloads the server.',
        'Content that is illegal, or that you have no right to share.',
        'Automated sign-ups or creating rooms in bulk.',
      ],
    ],
    [
      'Limits and changes',
      [
        'Runs have time, memory and output limits, and some languages or the terminal may be turned off.',
        'We may change or stop the service, and suspend accounts that break these rules.',
      ],
    ],
    [
      'No warranty',
      [
        'SYNQ is provided as is, without warranty of any kind, like its MIT-licensed source code. Keep your own copy of important work: use Download or Push to GitHub.',
      ],
    ],
  ],
};

/** /privacy and /terms. */
export default function LegalPage({ page }) {
  const doc = page === 'terms' ? TERMS : PRIVACY;
  useDocumentTitle(doc.title);
  usePageMeta({ description: doc.description });

  return (
    <main className="min-h-screen bg-bg px-6 py-16 text-muted">
      <article className="mx-auto max-w-[720px]">
        <Link
          to="/"
          className="mb-12 inline-flex items-center gap-2 text-[14px] text-muted hover:text-ink"
        >
          <ArrowLeft size={16} aria-hidden /> <LogoMark size={16} /> {APP.name}
        </Link>
        <HudLabel accent className="mb-4">
          Last updated {UPDATED}
        </HudLabel>
        <h1 className="display mb-10 text-[48px] leading-tight text-ink">{doc.title}</h1>
        {doc.sections.map(([heading, items]) => (
          <section key={heading} className="mb-10">
            <h2 className="mb-4 font-display text-[22px] font-semibold text-ink">{heading}</h2>
            <ul className="list-disc space-y-3 pl-5 text-[16px] leading-relaxed">
              {items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mt-16 border-t border-line pt-8 text-[14px]">
          Questions? Contact{' '}
          <a
            href={APP.author.github}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline underline-offset-4"
          >
            {APP.author.name} on GitHub
          </a>
          . See also the{' '}
          <Link
            to={page === 'terms' ? '/privacy' : '/terms'}
            className="text-ink underline underline-offset-4"
          >
            {page === 'terms' ? 'privacy policy' : 'terms of use'}
          </Link>
          .
        </p>
      </article>
    </main>
  );
}
