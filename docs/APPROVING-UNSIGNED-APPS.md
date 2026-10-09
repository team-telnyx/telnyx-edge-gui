# Opening Telnyx Edge when your computer blocks it

Telnyx Edge is shared inside the team, not through the Mac App Store or Microsoft Store. It isn't signed with a paid Apple or Microsoft developer certificate. So the first time you open a new version, macOS or Windows warns that it can't check who made it. That warning is about the **missing certificate**; it doesn't mean anything wrong was found in the app.

You approve each version once. After that it opens normally.

> **Only approve a copy you downloaded from the [team-telnyx/telnyx-edge-gui releases](https://github.com/team-telnyx/telnyx-edge-gui/releases).** If someone sent you the file another way, [check it first](#check-that-your-download-is-genuine).

- [Mac](#mac)
- [Windows](#windows)
- [Check that your download is genuine](#check-that-your-download-is-genuine)
- [Why this happens](#why-this-happens)

---

## Mac

First install the app: open the `.dmg` and drag **Telnyx Edge** onto **Applications**. Then open it from Applications. You'll see one of these messages:

- *"Telnyx Edge" Not Opened. Apple could not verify "Telnyx Edge" is free of malware…* (macOS 15 Sequoia and later)
- *"Telnyx Edge" can't be opened because Apple cannot check it for malicious software.* (macOS 13 Ventura and 14 Sonoma)

Click **Done** or **OK**. **Don't** click *Move to Bin*. Then use one of the methods below.

### Method 1: System Settings (all macOS versions)

1. Open **System Settings** ( → System Settings…).
2. Click **Privacy & Security** in the sidebar.
3. Scroll down to the **Security** section. You'll see *"Telnyx Edge" was blocked to protect your Mac.*
4. Click **Open Anyway**.
5. Enter your Mac password, or use Touch ID.
6. A last dialog asks whether you're sure. Click **Open Anyway** (or **Open**).

The **Open Anyway** button only appears for about an hour after the blocked attempt. If you don't see it, open the app again to get the warning, then come back.

### Method 2: Control-click (macOS 13 Ventura and 14 Sonoma only)

1. In **Finder → Applications**, hold **Control** and click **Telnyx Edge** (or right-click it).
2. Choose **Open**.
3. In the dialog, click **Open**.

Apple removed this shortcut in macOS 15 Sequoia. On macOS 15 and 26, use Method 1 or 3.

### Method 3: Terminal (all macOS versions, fastest)

Open **Terminal** (Applications → Utilities) and paste:

```bash
xattr -dr com.apple.quarantine "/Applications/Telnyx Edge.app"
```

Press Return and open the app normally. Nothing is printed when it works.

This removes the "downloaded from the internet" flag that macOS adds to downloaded files, and that flag is what triggers the check. It only affects this one app.

### If the Mac says the app *is damaged and can't be opened*

The app isn't actually damaged. This is how some macOS versions describe an unsigned app that still carries the download flag. Use **Method 3** above, then open the app again.

### If there's no *Open Anyway* button at all

Your Mac is probably managed by your company (MDM), and IT has set it to only allow apps from identified developers. Ask IT to allow **Telnyx Edge** (bundle ID `com.telnyx.edge-cp`), or use Method 3 if you're allowed to run Terminal commands.

### The Keychain question afterwards

The first time you tick **Remember on this Mac**, macOS asks whether *TelnyxEdge* may use *Telnyx Edge saved sign-ins* in your keychain. Enter your Mac password and click **Always Allow**. After each update this question comes back once, because every new build looks like a new app to macOS.

---

## Windows

When you open **TelnyxEdge-Setup.exe** (or `TelnyxEdge.exe`) for the first time, you'll see one of the messages below.

### "Windows protected your PC" (Microsoft Defender SmartScreen)

1. Click **More info**. It's a small link under the message.
2. Check that the app says **TelnyxEdge-Setup.exe** (or **TelnyxEdge.exe**) and *Publisher: Unknown publisher*.
3. Click **Run anyway**.

You only need to do this once per version.

### Before extracting the portable `.zip`

Windows marks files downloaded from the internet, and everything extracted from a marked `.zip` inherits the mark. Remove it before extracting:

1. Right-click the downloaded `.zip` → **Properties**.
2. On the **General** tab, tick **Unblock** at the bottom, next to *This file came from another computer…*.
3. Click **OK**, then extract.

Or, in PowerShell:

```powershell
Unblock-File "$env:USERPROFILE\Downloads\TelnyxEdge-*-win-*.zip"
```

### "Smart App Control blocked an app that may be unsafe"

**Smart App Control** is a stricter protection on some new Windows 11 installations. It blocks unsigned apps completely and has no *Run anyway* button. You can check it in **Windows Security → App & browser control → Smart App Control settings**:

- **On:** Telnyx Edge can't run. You can switch it **Off** there if you decide to; read the warning on that page first. On older Windows 11 builds, it can't be turned back on without reinstalling Windows. On a company device, ask IT instead.
- **Evaluation** or **Off:** it doesn't block the app. Use the SmartScreen steps above.

### If your company manages the PC

Tools like Intune, AppLocker or WDAC can block unsigned apps with no override. Ask IT to allow **TelnyxEdge.exe**, or ask for the app to be signed with the company's code-signing certificate.

### The Credential Manager

When you tick **Remember on this PC**, the key is stored in **Windows Credential Manager** under *Windows Credentials → Generic Credentials*, as `TelnyxEdge/…`. Windows doesn't ask any questions about it.

---

## Check that your download is genuine

Every release lists a **`SHA256SUMS.txt`** file next to the downloads. It contains a fingerprint of each file. If even one byte of your download is different, the fingerprint won't match.

**Mac** (Terminal):

```bash
shasum -a 256 ~/Downloads/TelnyxEdge-*.dmg
```

**Windows** (PowerShell):

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\TelnyxEdge-*" -Algorithm SHA256
```

Compare the long string it prints with the line for the same file name in `SHA256SUMS.txt`. The Windows command prints it in upper case, which doesn't matter. If they're the same, you have exactly the file GitHub built. If they differ, don't open it; download it again from the releases page.

---

## Why this happens

Apple and Microsoft only let an app open without warnings if it's signed with a certificate from a paid developer program. Apple also requires the app to be *notarized* (scanned by Apple). Telnyx Edge is built automatically on GitHub from the code in this repository, but it isn't signed with such a certificate. So your computer can't confirm who made it, and it asks you instead.

Signing removes these steps for everyone. On a Mac that needs an Apple Developer ID ($99/year). On Windows it needs a code-signing certificate, or Azure Trusted Signing. The build is ready for both; see [DEVELOPMENT.md](DEVELOPMENT.md).
