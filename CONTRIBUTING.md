# Contributing to SuperBrain

Thank you for your interest in contributing to SuperBrain! We welcome contributions from the community. This document provides guidelines and instructions for contributing.

## 📋 Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project you agree to abide by its terms.

## 🚀 Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- React Native / Expo CLI
- Android SDK (for mobile app development)
- Git

### Setting Up Development Environment

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python start.py
```

#### Frontend

```bash
cd superbrain-app
npm install
npx expo start
# Then press 'a' for Android or 'i' for iOS
```

## 🐛 Reporting Bugs

Before submitting a bug report:

1. Check the [GitHub Issues](https://github.com/sidinsearch/superbrain/issues) to ensure it hasn't been reported
2. Include as much detail as possible:
   - OS and Python/Node version
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots or error logs if applicable

### Bug Report Template

```
**Describe the bug:**
A clear description of what the bug is.

**To Reproduce:**
Steps to reproduce the behavior.

**Expected behavior:**
What should happen.

**Environment:**
- OS: [e.g., Ubuntu 22.04]
- Python version: [e.g., 3.10.5]
- App version: [e.g., 1.0.0]

**Additional context:**
Any other context about the problem.
```

## ✨ Proposing Features

1. Check existing [GitHub Issues](https://github.com/sidinsearch/superbrain/issues) to avoid duplicates
2. Describe the feature and use case clearly
3. Explain why it would be valuable to SuperBrain users
4. Provide implementation suggestions if you have ideas

### Feature Request Template

```
**Is your feature request related to a problem?**
Description of problem.

**Describe the solution you'd like:**
Clear description of the desired solution.

**Describe alternatives you've considered:**
Alternative solutions or features.

**Additional context:**
Any other context or screenshots.
```

## 💻 Making Code Changes

### Branch Strategy

- Create a new branch for your changes: `git checkout -b feature/your-feature-name`
- Use descriptive branch names
- Keep branches focused on a single feature/fix

### Commit Guidelines

- Write clear, descriptive commit messages
- Use present tense ("Add feature" not "Added feature")
- Reference issues when applicable: "Fix #123"
- Keep commits atomic and logical

Example:
```
Fix: Correct AI model timeout issue (#456)

- Increased timeout threshold from 30s to 60s
- Added retry logic for failed requests
- Updated tests for edge cases
```

### Code Style

#### Python Backend

- Follow [PEP 8](https://www.python.org/dev/peps/pep-0008/)
- Use type hints for function signatures
- Minimum 80% test coverage for new code
- Use `black` for formatting (see `pyproject.toml`)

#### TypeScript Frontend

- Follow ESLint configuration in project
- Use TypeScript strict mode
- Add inline documentation for complex logic
- Use Biome for formatting

### Testing

#### Backend Tests

```bash
cd backend
pytest tests/
pytest tests/ --cov=.
```

#### Frontend Tests

```bash
cd superbrain-app
npm test
```

All new code should include tests. Existing tests must pass before submitting a PR.

## 📝 Pull Request Process

1. **Fork the repository** and clone it locally
2. **Create a feature branch** from `main` (or `development` if it exists)
3. **Write tests** for your changes
4. **Update documentation** if needed
5. **Follow code style guidelines** (run linters/formatters)
6. **Push to your fork** and submit a Pull Request

### PR Checklist

Before submitting:

- [ ] Code follows the project's style guidelines
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings or errors
- [ ] I have added tests that prove my fix/feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

### PR Template

```
## Description
Brief description of changes.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues
Closes #(issue number if applicable)

## Testing Done
Description of testing performed.

## Screenshots (if applicable)
Add screenshots for UI changes.

## Checklist
- [ ] Tests pass
- [ ] Code style followed
- [ ] Documentation updated
```

## 📚 Documentation

Documentation is crucial to the project:

- Update README.md if you change user-facing features
- Add docstrings to Python functions and TypeScript functions
- Document new API endpoints with examples
- Update CHANGELOG.md for notable changes

## 🔐 Security

If you discover a security vulnerability, please email **security@example.com** instead of using the GitHub issue tracker.

## 📜 License

By contributing to SuperBrain, you agree that your contributions will be licensed under the [AGPL v3 License](LICENSE).

## ❓ Questions?

- Check the [documentation files](docs/)
- Review existing issues and discussions
- Ask in GitHub Discussions (if enabled)

## 🎉 Thank You!

Your contributions make SuperBrain better for everyone. We appreciate your time and effort!
