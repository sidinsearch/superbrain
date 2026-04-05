# superbrain-server

One-command installer and launcher for the SuperBrain backend.

Run the backend on any machine without cloning the repository.

## Install and Run

### Recommended (no global install)

```bash
npx -y superbrain-server@latest
```

### Global install (optional)

```bash
npm install -g superbrain-server
superbrain-server
```

### Beta channel

```bash
npx -y superbrain-server@beta
```

## What It Does on First Run

1. Unpacks backend files into `~/.superbrain-server`
2. Creates an isolated Python virtual environment
3. Installs Python dependencies
4. Runs interactive setup (AI keys, optional Instagram, token)
5. Starts the backend API server

## Requirements

- Node.js 20+
- Python 3.10+
- ffmpeg

## Commands

```bash
# Start server
superbrain-server

# Open interactive reset menu
superbrain-server reset

# Full reset (destructive)
superbrain-server reset --all
```

You can run the same with npx:

```bash
npx -y superbrain-server@latest reset
npx -y superbrain-server@latest reset --all
```

## Default Runtime Location

The backend is installed under your user home directory:

- Windows: `%USERPROFILE%/.superbrain-server`
- macOS/Linux: `~/.superbrain-server`

## Connect Mobile App

After backend starts:

1. Copy the Access Token shown in backend console
2. Open SuperBrain app Settings
3. Enter server URL and Access Token

## Troubleshooting

### Python not found

Install Python 3.10+ and verify:

```bash
python --version
```

On Windows, `py -3 --version` should also work.

### Backend not reachable from phone

Expose local port with ngrok:

```bash
ngrok http 5000
```

Use the generated HTTPS URL in app Settings.

## Links

- GitHub repository: https://github.com/sidinsearch/superbrain
- Main project docs: https://github.com/sidinsearch/superbrain#readme
- npm package page: https://www.npmjs.com/package/superbrain-server

## License

MIT (CLI wrapper)
