#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const SHELL = process.platform === 'win32';
const port = Number(process.env.SMOKE_FRONTEND_PORT ?? 3310);
const baseUrl = `http://127.0.0.1:${port}`;

const sharedEnv = {
  ...process.env,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? 'smoke-secret',
  NEXTAUTH_URL: `${baseUrl}`,
};

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: SHELL,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return response;
      }
    } catch (error) {
      // Swallow connection errors while waiting for server startup
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for server startup at ${url}`);
}

async function main() {
  console.log('> Building frontend (next build)');
  await run(NPX, ['next', 'build'], { env: sharedEnv, cwd: process.cwd() });

  console.log(`> Starting Next.js server on ${baseUrl}`);
  const server = spawn(NPX, ['next', 'start', '-p', String(port)], {
    env: sharedEnv,
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: SHELL,
  });
  const serverClosed = new Promise((resolve) => server.once('close', resolve));

  let serverExited = false;
  let serverExitCode = null;
  let serverExitSignal = null;
  let requestedStop = false;
  server.on('exit', (code, signal) => {
    serverExited = true;
    serverExitCode = code;
    serverExitSignal = signal;
    if (!requestedStop && code !== 0) {
      console.error(`next start exited unexpectedly with code ${code}`);
    }
  });

  const forwardLogs = (stream, label) => {
    stream.on('data', (chunk) => {
      process.stdout.write(`[next ${label}] ${chunk}`);
    });
  };

  forwardLogs(server.stdout, 'stdout');
  forwardLogs(server.stderr, 'stderr');

  try {
    await waitForServer(`${baseUrl}/`);

    const res = await fetch(`${baseUrl}/`);
    if (!res.ok) {
      throw new Error(`GET / returned status ${res.status}`);
    }
    const html = await res.text();
    console.log('> GET / length', html.length);

    const authResponse = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    console.log('> POST /api/auth/refresh status', authResponse.status);

    if (authResponse.status >= 500) {
      throw new Error('Auth refresh endpoint returned server error');
    }

    console.log('Frontend smoke test completed successfully.');
  } finally {
    if (!serverExited) {
      requestedStop = true;
      server.kill();
    }
    await serverClosed;
    if (requestedStop && serverExitCode === null && serverExitSignal) {
      // Normal termination via signal we initiated; treat as success.
    } else if (serverExitCode !== null && serverExitCode !== 0) {
      throw new Error(`Next.js server exited with code ${serverExitCode}`);
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Frontend smoke test failed:', error);
    process.exit(1);
  });
