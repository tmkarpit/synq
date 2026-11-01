// Vite dev client for QA on port 5190, proxying to the QA server on 4100.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const client = fileURLToPath(new URL('../../client', import.meta.url));
const env = { ...process.env, SYNQ_SERVER_URL: `http://127.0.0.1:${process.env.QA_PORT || '4100'}`, VITE_USE_MOCK: 'false' };
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5190', '--strictPort', '--host', '127.0.0.1'], { cwd: client, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
