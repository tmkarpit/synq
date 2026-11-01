// Starts an isolated SYNQ server for QA: port 4100, database synq_test, workspaces and
// data inside qa/, email off (codes go to the log). Never touches the real database.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const qa = fileURLToPath(new URL('..', import.meta.url));
const server = fileURLToPath(new URL('../../server', import.meta.url));
const env = {
  ...process.env,
  PORT: process.env.QA_PORT || '4100',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/synq_test',
  WORKSPACES_DIR: `${qa}workspaces`,
  DATA_DIR: `${qa}data`,
  SMTP_HOST: '',
  TWILIO_ACCOUNT_SID: '',
  OTP_DEV_LOG: 'true',
  // Production defaults, with every feature switched on explicitly so all of it can be
  // tested (QA_DEV=1 runs in development mode instead).
  ...(process.env.QA_DEV ? {} : {
    NODE_ENV: 'production',
    SHELL_ENABLED: 'true',
    RUN_LANGUAGES: 'javascript,typescript,python,c,cpp,java',
    CORS_ORIGIN: 'http://127.0.0.1:5190',
    STATIC_DIR: '',
  }),
};
const child = spawn(process.execPath, ['src/index.js'], { cwd: server, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
