# Contributing

Issues and pull requests are welcome. The project is provided as is, so there is no promise on response times.

## Before you open a pull request

1. Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). The project has no dependencies and needs Node 22.5 or later.
2. Run `npm test`. The tests use a mock Telnyx API, so they need no API key.
3. Add or update a test for what you changed.
4. Keep the change small and say in the pull request what it does and how you checked it.

## Please don't

- Add runtime dependencies. The server and the UI are plain Node.js and plain JavaScript on purpose.
- Put real API keys, account IDs or customer data in code, tests, screenshots or issues.

By contributing, you agree that your contribution is released under the [MIT License](LICENSE).
