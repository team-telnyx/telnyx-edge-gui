# Security

## Reporting a problem

Please do not open a public issue for a security problem. Report it privately by email to **security@telnyx.com**.

Include the version of the app, your operating system, and the steps to reproduce the problem. Never include a real Telnyx API key in a report.

## What the app does with your keys

- API keys are sent only to `api.telnyx.com`, from a server that runs on your own computer.
- Profiles are stored in a vault on your computer, encrypted with AES-256-GCM. The key is derived with scrypt from the API key you sign in with.
- Saved sign-ins are kept by the operating system: the Keychain on a Mac, Credential Manager on Windows.
- The window only ever shows the last four characters of a key.

The details are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#sign-in-and-profiles).
