# SuperBrain Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | :white_check_mark: Current Release |
| < 1.0   | :x: No          |

## Reporting a Vulnerability

**Do not post security vulnerabilities in public GitHub issues.**

If you believe you have found a security vulnerability in SuperBrain, please email **sidinsearch@gmail.com** with the following information:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** (if known)
4. **Your contact information** (so we can follow up)

### What to Expect

- **Initial Response:** Within 48 hours
- **Investigation:** Our team will confirm and assess the vulnerability
- **Patch Timeline:** Critical vulnerabilities will be patched ASAP
- **Credit:** You will be credited unless you prefer anonymity

## Security Best Practices for Users

When self-hosting SuperBrain:

### 1. Authentication & Access

- [ ] Use strong passwords for any user accounts
- [ ] Restrict network access to trusted IPs if possible
- [ ] Use HTTPS/TLS for API communication
- [ ] Keep API tokens secure and rotate regularly

### 2. Database & Storage

- [ ] Regularly backup your SQLite database
- [ ] Store database files with appropriate file permissions (mode 600)
- [ ] Use encrypted storage for sensitive data
- [ ] Never commit credentials to Git repositories

### 3. AI Provider Credentials

- [ ] Store API keys in environment variables (`.env` file, not in code)
- [ ] Never share or expose API keys
- [ ] Rotate API keys regularly
- [ ] Monitor for unauthorized usage

### 4. Instagram & Social Media

- [ ] Use dedicated Instagram account or app passwords
- [ ] Enable 2FA on Instagram if available
- [ ] Review app permissions regularly
- [ ] Be cautious with sharing personal data

### 5. Deployment

- [ ] Keep Docker images and dependencies updated
- [ ] Run SuperBrain in isolated Docker containers
- [ ] Use firewalls to restrict external access
- [ ] Monitor logs for suspicious activity
- [ ] Keep the backend server patched and updated

### 6. Development

- [ ] Run tests before committing code
- [ ] Use code review before merging PRs
- [ ] Scan dependencies for known vulnerabilities
- [ ] Keep Python packages updated

## Known Security Considerations

### Current Limitations

1. **Single-User Only**: No user authentication/authorization system
   - Deploy behind authentication proxy if multi-user access needed
   
2. **Local Database**: SQLite is not suitable for high-concurrency applications
   - For production at scale, consider PostgreSQL migration
   
3. **No Rate Limiting**: API endpoints lack per-user rate limiting
   - Implement at proxy/load balancer level if needed
   
4. **Data in Motion**: Content stored unencrypted locally
   - Implement disk encryption for sensitive deployments

## Security Updates

We follow semantic versioning:
- **PATCH** versions (1.0.x) contain security fixes
- **MINOR** versions (1.x.0) may include security improvements
- **MAJOR** versions (2.0.0) may introduce breaking security changes

## Dependency Management

We regularly audit dependencies for vulnerabilities:

```bash
# Check for vulnerabilities
pip install safety
safety check

# For Node dependencies
npm audit
```

## Contact

- **Security Email**: sidinsearch@gmail.com
- **GitHub Issues**: For non-security bugs
- **Discussions**: For general questions

---

**Last Updated**: March 2026
