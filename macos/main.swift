// Telnyx Edge — native macOS shell for the Edge Control Panel.
//
// Runs the panel's Node server on a private loopback port, shows it in a
// WebKit window, and keeps sign-in keys in the macOS Keychain so profiles
// survive restarts. Saved keys never reach the page: the shell signs in
// itself and hands the session cookie to the web view.

import AppKit
import Security
import WebKit

let appName = "Telnyx Edge"
let env = ProcessInfo.processInfo.environment
// EDGE_CP_DATA_DIR and EDGE_CP_KEYCHAIN_SERVICE let a test run stay away from real data.
let supportDir = env["EDGE_CP_DATA_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
  ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Telnyx Edge Control Panel", isDirectory: true)

// MARK: - Keychain

struct SavedSignIn: Codable {
  var id: String
  var name: String
  var apiKey: String
  var addedAt: Double
  var lastUsedAt: Double?

  var hint: String { "…" + String(apiKey.suffix(4)) }
  var page: [String: Any] { ["id": id, "name": name, "hint": hint, "addedAt": addedAt, "lastUsedAt": lastUsedAt ?? NSNull()] }
}

/// All saved sign-ins live in one generic-password item, as JSON.
enum Keychain {
  static let service = env["EDGE_CP_KEYCHAIN_SERVICE"] ?? "com.telnyx.edge-cp"
  static let account = "saved-signins"

  static var base: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  static func load() -> [SavedSignIn] {
    var q = base
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return [] }
    let list = (try? JSONDecoder().decode([SavedSignIn].self, from: data)) ?? []
    return list.sorted { ($0.lastUsedAt ?? $0.addedAt) > ($1.lastUsedAt ?? $1.addedAt) }
  }

  static func save(_ list: [SavedSignIn]) throws {
    if list.isEmpty {
      let status = SecItemDelete(base as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status) }
      return
    }
    let data = try JSONEncoder().encode(list)
    var status = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var add = base
      add[kSecValueData as String] = data
      add[kSecAttrLabel as String] = "\(appName) saved sign-ins"
      add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
      status = SecItemAdd(add as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw KeychainError(status) }
  }
}

struct KeychainError: LocalizedError {
  let status: OSStatus
  init(_ s: OSStatus) { status = s }
  var errorDescription: String? { (SecCopyErrorMessageString(status, nil) as String?) ?? "Keychain error \(status)" }
}

struct PanelError: LocalizedError {
  let message: String
  init(_ m: String) { message = m }
  var errorDescription: String? { message }
}

// MARK: - Node server

final class PanelServer {
  let port: Int
  private var process: Process?
  private let stdin = Pipe() // kept open for our lifetime; see EDGE_CP_EXIT_WITH_PARENT in server.js

  init() { port = PanelServer.freePort() }

  var base: URL { URL(string: "http://127.0.0.1:\(port)")! }

  static func freePort() -> Int {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    defer { close(fd) }
    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_port = 0
    var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) } }
    _ = withUnsafeMutablePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
    return Int(UInt16(bigEndian: addr.sin_port))
  }

  /// Finds a Node ≥ 22.5: bundled first, then the usual install locations, then the login shell's PATH.
  static func findNode() -> String? {
    var candidates: [String] = []
    if let bundled = Bundle.main.resourceURL?.appendingPathComponent("node/bin/node").path { candidates.append(bundled) }
    candidates += ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
    let nvm = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".nvm/versions/node")
    if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm.path) {
      candidates += versions.sorted { $0.compare($1, options: .numeric) == .orderedDescending }.map { nvm.appendingPathComponent("\($0)/bin/node").path }
    }
    if let fromShell = run("/bin/zsh", ["-lc", "command -v node"]) { candidates.append(fromShell) }
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) && nodeIsRecent($0) }
  }

  static func nodeIsRecent(_ path: String) -> Bool {
    guard let v = run(path, ["--version"]) else { return false }
    let parts = v.dropFirst().split(separator: ".").compactMap { Int($0) }
    guard parts.count >= 2 else { return false }
    return parts[0] > 22 || (parts[0] == 22 && parts[1] >= 5)
  }

  static func run(_ exe: String, _ args: [String]) -> String? {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    guard (try? p.run()) != nil else { return nil }
    p.waitUntilExit()
    let s = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return p.terminationStatus == 0 && s?.isEmpty == false ? s : nil
  }

  func start(onReady: @escaping (Result<Void, Error>) -> Void) {
    guard let node = PanelServer.findNode() else {
      return onReady(.failure(PanelError("Node.js 22.5 or later was not found. Install it with “brew install node” and open \(appName) again.")))
    }
    guard let serverDir = Bundle.main.resourceURL?.appendingPathComponent("server") else {
      return onReady(.failure(PanelError("The app bundle is missing its server files.")))
    }
    try? FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])

    let p = Process()
    p.executableURL = URL(fileURLWithPath: node)
    p.arguments = [serverDir.appendingPathComponent("server.js").path]
    p.currentDirectoryURL = serverDir
    var env = env
    env["PORT"] = String(port)
    env["HOST"] = "127.0.0.1"
    env["EDGE_CP_DATA_DIR"] = supportDir.path
    env["EDGE_CP_EXIT_WITH_PARENT"] = "1"
    p.environment = env

    let out = Pipe()
    p.standardInput = stdin
    p.standardOutput = out
    p.standardError = FileHandle.standardError
    var ready = false
    out.fileHandleForReading.readabilityHandler = { h in
      let chunk = String(data: h.availableData, encoding: .utf8) ?? ""
      FileHandle.standardOutput.write(chunk.data(using: .utf8)!)
      if !ready && chunk.contains("Control Panel on") {
        ready = true
        DispatchQueue.main.async { onReady(.success(())) }
      }
    }
    p.terminationHandler = { proc in
      out.fileHandleForReading.readabilityHandler = nil
      DispatchQueue.main.async {
        // stop() clears this handler first, so reaching here means the server died on its own.
        if !ready { onReady(.failure(PanelError("The panel server stopped during start-up (exit code \(proc.terminationStatus)).")))
        } else { (NSApp.delegate as? AppDelegate)?.serverDied(proc.terminationStatus) }
      }
    }
    do { try p.run(); process = p } catch { onReady(.failure(error)) }
  }

  func stop() {
    process?.terminationHandler = nil
    process?.terminate()
    process?.waitUntilExit()
  }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
  let server = PanelServer()
  var window: NSWindow!
  var webView: WKWebView!
  /// Serializes all Keychain access.
  let keychainQueue = DispatchQueue(label: "keychain")
  /// The saved sign-in the current session came from, so "Delete vault" can forget it too. Only touched on keychainQueue.
  var currentSavedId: String?

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMenu()
    buildWindow()
    server.start { [weak self] result in
      switch result {
      case .success: self?.webView.load(URLRequest(url: self!.server.base))
      case .failure(let e): self?.fatal(e.localizedDescription)
      }
    }
  }

  func applicationWillTerminate(_ n: Notification) { server.stop() }
  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

  func fatal(_ message: String) {
    let a = NSAlert()
    a.messageText = "\(appName) can’t start"
    a.informativeText = message
    a.alertStyle = .critical
    a.runModal()
    NSApp.terminate(nil)
  }

  func serverDied(_ code: Int32) {
    let a = NSAlert()
    a.messageText = "The panel server stopped"
    a.informativeText = "It exited with code \(code). \(appName) will close; your profiles are safe."
    a.runModal()
    NSApp.terminate(nil)
  }

  // MARK: window

  func buildWindow() {
    let config = WKWebViewConfiguration()
    config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "edgeNative")
    config.websiteDataStore = .nonPersistent() // sessions end with the app; saved keys live in the Keychain
    webView = WKWebView(frame: .zero, configuration: config)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.setValue(false, forKey: "drawsBackground") // no white flash before the page paints
    webView.allowsMagnification = true

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = appName
    window.minSize = NSSize(width: 900, height: 560)
    window.contentView = webView
    window.setFrameAutosaveName("MainWindow")
    if !window.setFrameUsingName("MainWindow") { window.center() }
    window.makeKeyAndOrderFront(nil)
  }

  func buildMenu() {
    let main = NSMenu()
    func submenu(_ title: String, _ items: [NSMenuItem]) {
      let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
      let m = NSMenu(title: title)
      items.forEach(m.addItem)
      item.submenu = m
      main.addItem(item)
    }
    func item(_ t: String, _ a: Selector?, _ k: String = "", _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: a, keyEquivalent: k)
      i.keyEquivalentModifierMask = mods
      return i
    }
    submenu(appName, [
      item("About \(appName)", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
      .separator(),
      item("Show Data Folder in Finder", #selector(showData)),
      item("Forget All Saved Sign-ins…", #selector(forgetAll)),
      .separator(),
      item("Hide \(appName)", #selector(NSApplication.hide(_:)), "h"),
      item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
      item("Show All", #selector(NSApplication.unhideAllApplications(_:))),
      .separator(),
      item("Quit \(appName)", #selector(NSApplication.terminate(_:)), "q"),
    ])
    submenu("Edit", [
      item("Undo", Selector(("undo:")), "z"),
      item("Redo", Selector(("redo:")), "z", [.command, .shift]),
      .separator(),
      item("Cut", #selector(NSText.cut(_:)), "x"),
      item("Copy", #selector(NSText.copy(_:)), "c"),
      item("Paste", #selector(NSText.paste(_:)), "v"),
      item("Select All", #selector(NSText.selectAll(_:)), "a"),
    ])
    submenu("View", [
      item("Reload", #selector(reload), "r"),
      .separator(),
      item("Actual Size", #selector(zoomReset), "0"),
      item("Zoom In", #selector(zoomIn), "+"),
      item("Zoom Out", #selector(zoomOut), "-"),
      .separator(),
      item("Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
    ])
    let win = NSMenu(title: "Window")
    win.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
    win.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
    let winItem = NSMenuItem(title: "Window", action: nil, keyEquivalent: "")
    winItem.submenu = win
    main.addItem(winItem)
    NSApp.windowsMenu = win
    NSApp.mainMenu = main
  }

  @objc func reload() { webView.reload() }
  @objc func zoomReset() { webView.pageZoom = 1 }
  @objc func zoomIn() { webView.pageZoom = min(webView.pageZoom + 0.1, 2) }
  @objc func zoomOut() { webView.pageZoom = max(webView.pageZoom - 0.1, 0.6) }
  @objc func showData() { NSWorkspace.shared.activateFileViewerSelecting([supportDir]) }

  @objc func forgetAll() {
    keychainQueue.async {
      let n = Keychain.load().count
      DispatchQueue.main.async {
        let a = NSAlert()
        a.messageText = n == 0 ? "No saved sign-ins" : "Forget \(n) saved sign-in\(n == 1 ? "" : "s")?"
        a.informativeText = n == 0 ? "Keys you choose to remember when signing in are kept in the macOS Keychain."
          : "The keys are removed from the Keychain. Vaults and profiles stay on this Mac and open again when you sign in with the same key."
        if n > 0 { a.addButton(withTitle: "Forget"); a.buttons[0].hasDestructiveAction = true; a.addButton(withTitle: "Cancel") }
        guard a.runModal() == .alertFirstButtonReturn, n > 0 else { return }
        self.keychainQueue.async {
          let result = Result { try Keychain.save([]) }
          DispatchQueue.main.async {
            if case .failure(let e) = result { NSAlert(error: e).runModal() } else { self.notifyPage("saved-changed") }
          }
        }
      }
    }
  }

  // MARK: page bridge

  /// app.js is a module, so the shell talks to it with DOM events rather than globals.
  func notifyPage(_ event: String, _ detail: String = "") {
    let d = (try? String(data: JSONSerialization.data(withJSONObject: [detail], options: []), encoding: .utf8)) ?? "[\"\"]"
    webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('edge-native', { detail: { event: '\(event)', text: \(d)[0] } }))")
  }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
    // Only the panel itself may use the bridge.
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "127.0.0.1",
          message.frameInfo.securityOrigin.port == server.port,
          let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return replyHandler(nil, "Not allowed") }
    if cmd == "copy" {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString((body["text"] as? String) ?? "", forType: .string)
      return replyHandler(true, nil)
    }
    // Keychain calls can wait on a macOS permission prompt, so keep them off the main thread.
    let reply = { (value: Any?, error: String?) in DispatchQueue.main.async { replyHandler(value, error) } }
    keychainQueue.async { self.bridge(cmd, body, reply) }
  }

  /// Runs on keychainQueue.
  func bridge(_ cmd: String, _ body: [String: Any], _ reply: @escaping (Any?, String?) -> Void) {
    let attempt = { (work: () throws -> Void) in
      do { try work(); reply(true, nil) } catch { reply(nil, error.localizedDescription) }
    }
    switch cmd {
    case "saved":
      reply(Keychain.load().map(\.page), nil)
    case "remember":
      guard let key = body["apiKey"] as? String, !key.isEmpty else { return reply(nil, "Missing key") }
      var list = Keychain.load()
      let now = Date().timeIntervalSince1970 * 1000
      let name = (body["name"] as? String) ?? "Default"
      if let i = list.firstIndex(where: { $0.apiKey == key }) {
        list[i].name = name; list[i].lastUsedAt = now; currentSavedId = list[i].id
      } else {
        let s = SavedSignIn(id: UUID().uuidString, name: name, apiKey: key, addedAt: now, lastUsedAt: now)
        list.append(s); currentSavedId = s.id
      }
      attempt { try Keychain.save(list) }
    case "forget":
      let id = body["id"] as? String
      if id == currentSavedId { currentSavedId = nil }
      attempt { try Keychain.save(Keychain.load().filter { $0.id != id }) }
    case "forgetCurrent":
      guard let id = currentSavedId else { return reply(true, nil) }
      currentSavedId = nil
      attempt { try Keychain.save(Keychain.load().filter { $0.id != id }) }
    case "signin":
      guard let id = body["id"] as? String, let saved = Keychain.load().first(where: { $0.id == id }) else { return reply(nil, "That saved sign-in no longer exists") }
      signIn(saved) { result in
        switch result { case .success: reply(true, nil); case .failure(let e): reply(nil, e.localizedDescription) }
      }
    default:
      reply(nil, "Unknown command")
    }
  }

  /// Signs in with a saved key and gives the resulting session cookie to the web view.
  func signIn(_ saved: SavedSignIn, done: @escaping (Result<Void, Error>) -> Void) {
    let url = server.base.appendingPathComponent("auth/login")
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("1", forHTTPHeaderField: "X-Panel")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["apiKey": saved.apiKey, "profileName": saved.name])
    URLSession(configuration: .ephemeral).dataTask(with: req) { data, response, error in
      if let error { return done(.failure(error)) }
      guard let http = response as? HTTPURLResponse else { return done(.failure(PanelError("No response from the panel server"))) }
      let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
      guard http.statusCode == 200 else { return done(.failure(PanelError((json?["error"] as? String) ?? "Sign-in failed (HTTP \(http.statusCode))"))) }
      let headers = http.allHeaderFields.reduce(into: [String: String]()) { $0["\($1.key)"] = "\($1.value)" }
      let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
      guard !cookies.isEmpty else { return done(.failure(PanelError("The panel server did not start a session"))) }

      // Keep the saved name in step with the sign-in profile, and remember when it was used.
      self.keychainQueue.async {
        var list = Keychain.load()
        if let i = list.firstIndex(where: { $0.id == saved.id }) {
          let profiles = json?["profiles"] as? [[String: Any]]
          if let name = profiles?.first(where: { ($0["login"] as? Bool) == true })?["name"] as? String { list[i].name = name }
          list[i].lastUsedAt = Date().timeIntervalSince1970 * 1000
          try? Keychain.save(list)
        }
        self.currentSavedId = saved.id
      }
      DispatchQueue.main.async {
        let store = self.webView.configuration.websiteDataStore.httpCookieStore
        let group = DispatchGroup()
        for c in cookies { group.enter(); store.setCookie(c) { group.leave() } }
        group.notify(queue: .main) { done(.success(())) }
      }
    }.resume()
  }

  // MARK: navigation, links and downloads

  func isPanel(_ url: URL?) -> Bool { url?.host == "127.0.0.1" && url?.port == server.port }

  func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { return decisionHandler(.cancel) }
    if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(action.shouldPerformDownload ? .download : .allow) }
    if !isPanel(url) {
      if ["http", "https", "mailto"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
      return decisionHandler(.cancel)
    }
    decisionHandler(action.shouldPerformDownload ? .download : .allow)
  }

  func webView(_ w: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
    decisionHandler(disposition.lowercased().hasPrefix("attachment") || !response.canShowMIMEType ? .download : .allow)
  }

  func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    panel.beginSheetModal(for: window) { resp in
      guard resp == .OK, let url = panel.url else { return completionHandler(nil) }
      try? FileManager.default.removeItem(at: url) // the save panel already asked about replacing it
      completionHandler(url)
    }
  }

  func downloadDidFinish(_ d: WKDownload) {
    notifyPage("toast", "Download saved")
  }

  func download(_ d: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    NSAlert(error: error).beginSheetModal(for: window)
  }

  // target=_blank and window.open go to the default browser.
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url, !isPanel(url) { NSWorkspace.shared.open(url) }
    return nil
  }

  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = m; a.beginSheetModal(for: window) { _ in completionHandler() }
  }

  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
