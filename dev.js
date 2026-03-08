const { spawn } = require('child_process');
const path = require('path');

const root = __dirname;
const reactScriptsBin = path.join(
  root,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'react-scripts.cmd' : 'react-scripts'
);

const children = [];

function startProcess(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${label} exited with code ${code}`);
    }
  });

  children.push(child);
  return child;
}

function shutdown(signal) {
  // Forward the signal to both child processes so ports are released cleanly.
  children.forEach((child) => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startProcess('creator-api', process.execPath, ['server.js']);
startProcess('creator-frontend', reactScriptsBin, ['start'], {
  env: {
    PORT: '3011',
    BROWSER: 'none',
  },
});
