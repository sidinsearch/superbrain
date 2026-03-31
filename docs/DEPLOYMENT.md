# SuperBrain Production Deployment Guide

## 📋 Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Backend Deployment](#backend-deployment)
- [Android App Deployment](#android-app-deployment)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Troubleshooting](#troubleshooting)
- [Security Best Practices](#security-best-practices)

---

## Pre-Deployment Checklist

### ✅ Code Quality

- [ ] All tests passing (`pytest tests/` for backend)
- [ ] No console warnings or errors in logs
- [ ] Code linting passes (`biome check` for TypeScript)
- [ ] No hardcoded secrets or API keys
- [ ] Environment variables documented in `.env.example`
- [ ] Dependencies updated and secure (`pip check`, `npm audit`)

### ✅ Configuration

- [ ] `.env` file created with production values
- [ ] Database backed up
- [ ] API keys properly configured
- [ ] Instagram credentials validated
- [ ] CORS origins restricted to production domains
- [ ] Debug mode disabled (`ENVIRONMENT=production`)

### ✅ Security

- [ ] HTTPS/TLS certificates obtained
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] API authentication verified
- [ ] Database access restricted
- [ ] Logs don't contain sensitive data

### ✅ Documentation

- [ ] README.md updated with deployment info
- [ ] API documentation up-to-date
- [ ] Configuration options documented
- [ ] Known issues documented

---

## Backend Deployment

### Option 1: Docker (Recommended)

#### Quick Start

```bash
# 1. Navigate to backend directory
cd backend

# 2. Create production environment file
cp .env.example .env
# Edit .env with production values

# 3. Build and start containers
docker-compose build
docker-compose up -d

# 4. Verify health
curl http://localhost:5000/health
```

#### Docker Compose Services

```bash
# View running services
docker-compose ps

# View logs
docker-compose logs -f superbrain-api

# Stop services
docker-compose down

# Restart services
docker-compose restart

# Scale workers (update docker-compose.yml WORKERS env var)
docker-compose up -d --scale superbrain-api=1
```

#### Volume Persistence

```bash
# Database persists in volume: superbrain-db
# Configuration persists in volume: superbrain-config
# Uploads persist in volume: superbrain-uploads
# Logs persist in volume: superbrain-logs

# To backup database
docker-compose exec superbrain-api cp /app/superbrain.db /app/superbrain.db.backup
```

### Option 2: Systemd Service (Linux)

```bash
# Create systemd service file
sudo nano /etc/systemd/system/superbrain.service

[Unit]
Description=SuperBrain API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/app/backend
Environment="ENVIRONMENT=production"
environment="PORT=5000"
ExecStart=/usr/bin/python3 -m uvicorn api:app --host 0.0.0.0 --port 5000 --workers 4
Restart=on-failure

[Install]
WantedBy=multi-user.target

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable superbrain
sudo systemctl start superbrain

# View status
sudo systemctl status superbrain

# View logs
sudo journalctl -u superbrain -f
```

### Option 3: Manual Python

```bash
# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env

# Start application
export ENVIRONMENT=production
python -m uvicorn api:app --host 0.0.0.0 --port 5000 --workers 4
```

### Health Checks

```bash
# Check API health
curl http://localhost:5000/health

# Check database
curl http://localhost:5000/db-status

# Monitor logs
docker-compose logs -f superbrain-api
# or
tail -f /var/log/superbrain.log
```

---

## Android App Deployment

### Build APK for Release

```bash
# 1. Update version in app.json
nano app.json
# Update "version": "1.0.0"

# 2. Generate keystore (one-time)
keytool -genkey -v -keystore superbrain.jks -keyalg RSA -keysize 2048 -validity 9999 \
  -alias superbrain-key

# 3. Build signed APK
eas build --platform android --build-type apk

# Or build locally
cd superbrain-app/android
./gradlew assembleRelease

# 4. APK located at:
# android/app/build/outputs/apk/release/app-release.apk
```

### Build AAB for Play Store

```bash
# 1. Build AAB
eas build --platform android --build-type aab

# Or locally
cd superbrain-app/android
./gradlew bundleRelease

# 2. AAB located at:
# android/app/build/outputs/bundle/release/app-release.aab

# 3. Upload to Google Play Console
# - Create app listing
# - Upload AAB
# - Fill in description, screenshots, etc.
# - Configure release settings
# - Submit for review
```

### App Store Configuration

1. **App Metadata**
   - Title: SuperBrain
   - Description: Clear, concise description
   - Screenshots: 6-8 high-quality screenshots
   - Feature graphic: 1024x500px

2. **Content Rating**
   - Fill out content rating questionnaire
   - Category: Productivity/Tools

3. **Release Notes**
   - Document new features and fixes
   - Link to changelog

4. **Privacy Policy**
   - Host privacy policy URL
   - Data collection transparency

---

## Monitoring & Maintenance

### Log Monitoring

```bash
# View real-time logs
docker-compose logs -f superbrain-api

# Search logs
docker-compose logs | grep "ERROR"
docker-compose logs | grep "warning"

# Export logs
docker-compose logs --timestamps > logs_backup.txt
```

### Performance Monitoring

```bash
# Check container resource usage
docker stats

# Monitor database size
du -sh backend/superbrain.db

# Check disk usage
df -h

# Memory usage
free -h
```

### Automated Backups

```bash
# Schedule daily database backup via crontab
crontab -e

# Add this line for daily backup at 2 AM
0 2 * * * cd /app/backend && cp superbrain.db superbrain.db.bak.$(date +\%Y\%m\%d) && find . -name "superbrain.db.bak.*" -mtime +30 -delete

# View cron logs
sudo tail -f /var/log/syslog | grep CRON
```

### Update Procedures

```bash
# 1. Back up database
docker-compose exec superbrain-api cp /app/superbrain.db /app/superbrain.db.backup

# 2. Pull latest code
git pull origin main

# 3. Rebuild Docker image
docker-compose build --no-cache

# 4. Update containers (zero-downtime)
docker-compose up -d

# 5. Verify health
curl http://localhost:5000/health

# 6. Check logs for errors
docker-compose logs superbrain-api

# 7. Rollback if needed
docker-compose down
docker-compose up -d  # Uses previous image
docker-compose exec superbrain-api cp /app/superbrain.db.backup /app/superbrain.db
```

---

## Troubleshooting

### API Won't Start

```bash
# Check logs
docker-compose logs superbrain-api

# Common issues:
# 1. Port already in use
lsof -i :5000
kill -9 <PID>

# 2. Invalid configuration
docker-compose exec superbrain-api python -c "from config_settings import settings; print(settings.LOG_LEVEL)"

# 3. Database locked
docker-compose exec superbrain-api python -c "import sqlite3; sqlite3.connect('superbrain.db')"
```

### Database Issues

```bash
# Check database integrity
docker-compose exec superbrain-api python -c "import sqlite3; db = sqlite3.connect('superbrain.db'); cursor = db.cursor(); cursor.execute('PRAGMA integrity_check'); print(cursor.fetchall())"

# Reset database (WARNING: Removes all data)
docker-compose exec superbrain-api rm superbrain.db
docker-compose restart
```

### API Requests Failing

```bash
# Test connectivity
docker-compose exec superbrain-api curl -v http://localhost:5000/health

# Check API logs for errors
docker-compose logs superbrain-api | grep ERROR

# Test with valid API key
curl -H "X-API-Key: your-key" http://localhost:5000/posts
```

### Out of Memory

```bash
# Check memory usage
docker stats

# Limit container memory in docker-compose.yml
services:
  superbrain-api:
    deploy:
      resources:
        limits:
          memory: 2G

# Clear unused docker resources
docker system prune -a
docker volume prune
```

---

## Security Best Practices

### Network Security

```bash
# 1. Use firewall to restrict access
sudo ufw allow 5000/tcp  # Only allow internal network
sudo ufw allow from 192.168.1.0/24 to any port 5000

# 2. Use HTTPS in production (nginx proxy)
# See nginx-proxy configuration below

# 3. Disable SSH root login
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart ssh
```

### Nginx Reverse Proxy Setup

```nginx
# /etc/nginx/sites-available/superbrain

upstream superbrain_backend {
    server localhost:5000;
}

server {
    listen 80;
    server_name api.superbrain.app;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.superbrain.app;

    # SSL certificates (use certbot)
    ssl_certificate /etc/letsencrypt/live/api.superbrain.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.superbrain.app/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Proxy configuration
    location / {
        proxy_pass http://superbrain_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;
}
```

### SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot certonly --nginx -d api.superbrain.app

# Auto-renew
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Secrets Management

```bash
# Use environment variables (never in code)
export API_KEY=$(openssl rand -hex 32)
export DB_PASSWORD=$(openssl rand -base64 32)

# Or use systemd secret files
sudo echo "API_KEY=..." | sudo tee /etc/superbrain/secrets > /dev/null
sudo chmod 600 /etc/superbrain/secrets
```

---

## Performance Optimization

### Database Optimization

```sql
-- Check indices
PRAGMA index_info(idx_posts_created);

-- Add missing indices
CREATE INDEX idx_posts_user ON posts(user_id);
CREATE INDEX idx_posts_category ON posts(category);

-- Vacuum database
VACUUM;
```

### Caching

```bash
# Configure header caching in nginx
# (See nginx configuration above)
```

### Load Testing

```bash
# Install Apache Bench
sudo apt-get install apache2-utils

# Load test
ab -n 1000 -c 10 http://localhost:5000/health
```

---

## Contact & Support

- **Issues**: Report on GitHub
- **Security**: Email security@example.com
- **Documentation**: Check docs/ folder

**Last Updated**: March 2026
