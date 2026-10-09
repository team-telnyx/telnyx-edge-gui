// Telnyx Edge for Windows: native shell for the Edge Control Panel.
//
// Runs the panel's Node server on a private loopback port, shows it in a
// WebView2 window, and keeps sign-in keys in Windows Credential Manager so
// profiles survive restarts.
//
//   TelnyxEdge.exe                start the app
//   TelnyxEdge.exe --smoke-test   start the server, check it answers, exit (0 = ok); used by CI

using Microsoft.Win32;

namespace TelnyxEdge;

static class App
{
    public const string Name = "Telnyx Edge";

    // EDGE_CP_DATA_DIR (and EDGE_CP_CREDENTIAL_PREFIX) let a test run stay away from real data.
    public static readonly string DataDir = Environment.GetEnvironmentVariable("EDGE_CP_DATA_DIR")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Telnyx Edge Control Panel");

    public static readonly string LogFile = Path.Combine(DataDir, "logs", "app.log");
    static readonly object logLock = new();

    public static void Log(string line)
    {
        try { lock (logLock) File.AppendAllText(LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {line}{Environment.NewLine}"); }
        catch { /* logging must never break the app */ }
    }

    public static bool SystemUsesDarkMode()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
    }

    [STAThread]
    static int Main(string[] args)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(LogFile)!);
        File.WriteAllText(LogFile, ""); // one run per log
        Log($"{Name} {Application.ProductVersion} on {Environment.OSVersion} ({System.Runtime.InteropServices.RuntimeInformation.OSArchitecture})");

        if (args.Contains("--smoke-test")) return SmokeTest().GetAwaiter().GetResult();

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }

    /// Starts the bundled server and checks the page and API answer, without a window.
    static async Task<int> SmokeTest()
    {
        try
        {
            using var server = new PanelServer();
            await server.StartAsync();
            using var http = new HttpClient();
            var page = await http.GetAsync(server.Base);
            var me = await http.GetAsync(new Uri(server.Base, "auth/me"));
            // Round-trip a Credential Manager entry (set EDGE_CP_CREDENTIAL_PREFIX to keep it apart from real ones).
            var probe = new SavedSignIn { Id = "smoke-" + Guid.NewGuid().ToString("N"), Name = "Smoke test", ApiKey = "KEY_SMOKE_0123456789abcdef", AddedAt = SavedSignIns.Now() };
            SavedSignIns.Save(probe);
            var roundTrip = SavedSignIns.Load().FirstOrDefault(s => s.Id == probe.Id);
            SavedSignIns.Delete(probe.Id);
            var credentialsOk = roundTrip is { Name: "Smoke test", ApiKey: "KEY_SMOKE_0123456789abcdef", Hint: "…cdef" }
                && SavedSignIns.Load().All(s => s.Id != probe.Id);
            var webview = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString();
            Log($"smoke: page {(int)page.StatusCode}, /auth/me {(int)me.StatusCode}, credentials {(credentialsOk ? "ok" : "FAILED")}, WebView2 {webview}");
            var ok = page.IsSuccessStatusCode && (int)me.StatusCode == 401 && credentialsOk;
            Log(ok ? "smoke: OK" : "smoke: FAILED");
            return ok ? 0 : 1;
        }
        catch (Exception ex)
        {
            Log($"smoke: FAILED {ex}");
            return 1;
        }
    }
}
