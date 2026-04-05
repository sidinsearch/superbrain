#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

const pkgMeta = require('../package.json');
const TARGET_DIR = path.join(os.homedir(), '.superbrain-server');
const PAYLOAD_DIR = path.join(__dirname, '../payload');

// Files that should NEVER be overwritten during an unpack/upgrade if they already exist in the target
const PROTECTED_FILES = [
  'superbrain.db',
  'superbrain.db-shm',
  'superbrain.db-wal',
  'token.txt',
  '.env',
  '.api_keys',
  'localtunnel.log',
  'localtunnel_enabled.txt',
  '.setup_done',
  'config/instagram_session.json',
  'config/.api_keys',
  'config/localtunnel_enabled.txt',
  'config/localtunnel.log'
];

function log(msg) {
  console.log(`\x1b[36m✨ [SuperBrain CLI]\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m⚠️ [SuperBrain CLI]\x1b[0m ${msg}`);
}

function errorOut(msg) {
  console.log(`\x1b[31m❌ [SuperBrain CLI]\x1b[0m ${msg}`);
  process.exit(1);
}

// Check if Python binaries are accessible
function getPythonCommand() {
  const candidates = os.platform() === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
  
  for (const cmd of candidates) {
    try {
      const res = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 3000 });
      if (res.status === 0 && res.stdout) {
        // Windows Store python wrapper aliases execute but return no text, wait, they actually popup the store.
        // Usually, a valid python prints "Python 3.X.Y".
        if (res.stdout.toLowerCase().includes('python 3.')) {
           return cmd;
        }
      }
    } catch (e) {
      // Command missing
    }
  }
  return null;
}

function safeUnpack() {
  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  log(`Unpacking server core to ${TARGET_DIR} ...`);

  // Recursively copy files from payload
  function copyRecursive(src, dest) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      if (!fs.existsSync(dest)) fs.mkdirSync(dest);
      for (const child of fs.readdirSync(src)) {
        copyRecursive(path.join(src, child), path.join(dest, child));
      }
    } else {
      // It's a file
      const relativePath = path.relative(TARGET_DIR, dest).replace(/\\/g, '/');
      const isProtected = PROTECTED_FILES.includes(relativePath);
      
      if (isProtected && fs.existsSync(dest)) {
        // Skip overwriting user's database or tokens
        return;
      }
      fs.copyFileSync(src, dest);
    }
  }

  if (!fs.existsSync(PAYLOAD_DIR)) {
    errorOut("Payload directory missing inside npm package!");
  }
  
  copyRecursive(PAYLOAD_DIR, TARGET_DIR);

  // Write out version explicitly
  fs.writeFileSync(path.join(TARGET_DIR, 'VERSION'), pkgMeta.version, 'utf-8');
  log(`Extraction complete (v${pkgMeta.version}). Data persisted cleanly.`);
}

function checkUpgrades() {
  const versionFile = path.join(TARGET_DIR, 'VERSION');
  let currentVersion = '0.0.0';
  if (fs.existsSync(versionFile)) {
    currentVersion = fs.readFileSync(versionFile, 'utf-8').trim();
  }

  if (currentVersion !== pkgMeta.version) {
    log(`Version mismatch detected (Local: ${currentVersion} -> NPM: ${pkgMeta.version}). Auto-upgrading...`);
    safeUnpack();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTOR
// ─────────────────────────────────────────────────────────────────────────────

// 1. Python check
const pyCommand = getPythonCommand();
if (!pyCommand) {
  errorOut('Could not find Python >= 3.9 on this system. Please install Python to run SuperBrain.');
}

// 2. Safe unpack/upgrade
checkUpgrades();

// 3. Command Routing logic
const userArgs = process.argv.slice(2);
let targetScript = 'start.py';
let finalArgs = userArgs;

if (userArgs.length > 0) {
  const cmd = userArgs[0].toLowerCase();
  if (cmd === 'reset') {
    targetScript = 'reset.py';
    finalArgs = userArgs.slice(1); // remove 'reset' from arguments passed to python
  } else if (cmd === '-h' || cmd === '--help') {
    console.log(`
  SuperBrain Server Wrapper (v${pkgMeta.version})

  Usage:
    superbrain-server               -> Starts the backend engine
    superbrain-server reset         -> Open Reset Menu
    superbrain-server reset --all   -> Force complete wipe
    `);
    process.exit(0);
  }
}

// 4. Execution
log(`Spinning up Python Engine via ${targetScript}...`);
const child = spawn(pyCommand, [targetScript, ...finalArgs], {
  cwd: TARGET_DIR,
  stdio: 'inherit'
});

// 5. Zombie Protection
function handleShutdown(signal) {
  warn(`Received ${signal}. Shutting down Python engine...`);
  child.kill('SIGINT'); 
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

child.on('close', (code) => {
  process.exit(code || 0);
});
