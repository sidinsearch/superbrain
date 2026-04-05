const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../../backend');
const PAYLOAD_DIR = path.resolve(__dirname, '../payload');

// Files & directories to NEVER package into the public NPM payload
const EXCLUSIONS = [
  '.venv',
  '__pycache__',
  '.pytest_cache',
  'superbrain.db',
  'superbrain.db-shm',
  'superbrain.db-wal',
  'token.txt',
  '.api_keys',
  'localtunnel.log',
  'localtunnel_enabled.txt',
  'error_log_utf8.txt',
  'temp',
  '.setup_done',
  '.env'
];

function isExcluded(src) {
  const baseName = path.basename(src);
  return EXCLUSIONS.includes(baseName);
}

console.log('📦 Building SuperBrain Server Payload...');

if (fs.existsSync(PAYLOAD_DIR)) {
  fs.rmSync(PAYLOAD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(PAYLOAD_DIR, { recursive: true });

fs.cpSync(BACKEND_DIR, PAYLOAD_DIR, {
  recursive: true,
  filter: (src) => {
    if (isExcluded(src)) {
      console.log(`  Skipping: ${path.basename(src)}`);
      return false;
    }
    return true;
  }
});

console.log('✅ Payload built successfully!');
