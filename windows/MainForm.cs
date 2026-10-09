// The app window: shows the panel in WebView2 and answers the page's requests
// for saved sign-ins. Saved keys never reach the page: the app signs in itself
// and hands the session cookie to WebView2.

using System.Diagnostics;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TelnyxEdge;

sealed class MainForm : Form
{
    readonly PanelServer server = new();
    readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(0xfe, 0xfd, 0xf5) };
    /// The saved sign-in the current session came from, so "Delete vault" can forget it too.
    string? currentSavedId;

    public MainForm()
    {
        Text = App.Name;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(900, 560);
        Size = new Size(1320, 860);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web);
        Load += async (_, _) => await StartAsync();
        FormClosed += (_, _) => server.Dispose();
        server.Died += code => BeginInvoke(() =>
        {
            MessageBox.Show(this, $"The panel server stopped (exit code {code}). {App.Name} will close; your profiles are safe.\n\nLog: {App.LogFile}", App.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        });
    }

    async Task StartAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(App.DataDir, "WebView2"));
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            Fail("The Microsoft Edge WebView2 Runtime is not installed. It comes with Windows 11; on other systems, install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and open Telnyx Edge again.");
            return;
        }
        var core = web.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("EDGE_CP_DEVTOOLS") == "1";
        core.WebMessageReceived += OnWebMessage;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.DownloadStarting += OnDownloadStarting;
        try
        {
            await server.StartAsync();
            core.Navigate(server.Base.ToString());
        }
        catch (Exception ex) { Fail(ex.Message); }
    }

    void Fail(string message)
    {
        MessageBox.Show(this, message, $"{App.Name} can’t start", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }

    bool IsPanel(string? uri) =>
        Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Host == "127.0.0.1" && u.Port == server.Port;

    // ---------- page bridge ----------

    /// Tells the page about something that happened outside it.
    void Notify(string evt, string text = "") =>
        web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { @event = evt, text }));

    async void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsPanel(e.Source)) return; // only the panel itself may use the bridge
        int id;
        string cmd;
        JsonElement body;
        try
        {
            body = JsonDocument.Parse(e.WebMessageAsJson).RootElement;
            id = body.GetProperty("id").GetInt32();
            cmd = body.GetProperty("cmd").GetString() ?? "";
        }
        catch { return; }

        object? value = null;
        string? error = null;
        try { value = await HandleAsync(cmd, body); }
        catch (Exception ex) { error = ex.Message; }
        web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, value, error }));
    }

    static string? Str(JsonElement body, string name) =>
        body.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    async Task<object?> HandleAsync(string cmd, JsonElement body)
    {
        switch (cmd)
        {
            case "saved":
                return SavedSignIns.Load().Select(s => s.ForPage()).ToList();

            case "remember":
            {
                var key = Str(body, "apiKey");
                if (string.IsNullOrEmpty(key)) throw new ArgumentException("Missing key");
                var name = Str(body, "name") ?? "Default";
                var saved = SavedSignIns.Load().FirstOrDefault(s => s.ApiKey == key)
                    ?? new SavedSignIn { Id = Guid.NewGuid().ToString("N"), ApiKey = key, AddedAt = SavedSignIns.Now() };
                saved.Name = name;
                saved.LastUsedAt = SavedSignIns.Now();
                SavedSignIns.Save(saved);
                currentSavedId = saved.Id;
                return true;
            }

            case "forget":
            {
                var id = Str(body, "id") ?? "";
                SavedSignIns.Delete(id);
                if (id == currentSavedId) currentSavedId = null;
                return true;
            }

            case "forgetCurrent":
                if (currentSavedId is not null) SavedSignIns.Delete(currentSavedId);
                currentSavedId = null;
                return true;

            case "signin":
            {
                var id = Str(body, "id");
                var saved = SavedSignIns.Load().FirstOrDefault(s => s.Id == id)
                    ?? throw new InvalidOperationException("That saved sign-in no longer exists");
                await SignInAsync(saved);
                return true;
            }

            case "copy":
            {
                var text = Str(body, "text");
                if (string.IsNullOrEmpty(text)) Clipboard.Clear(); else Clipboard.SetText(text);
                return true;
            }

            default:
                throw new InvalidOperationException("Unknown command");
        }
    }

    /// Signs in with a saved key and gives the resulting session cookie to WebView2.
    async Task SignInAsync(SavedSignIn saved)
    {
        using var http = new HttpClient(new HttpClientHandler { UseCookies = false });
        using var req = new HttpRequestMessage(HttpMethod.Post, new Uri(server.Base, "auth/login"))
        {
            Content = JsonContent.Create(new { apiKey = saved.ApiKey, profileName = saved.Name }),
        };
        req.Headers.Add("X-Panel", "1");
        using var res = await http.SendAsync(req);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        if (!res.IsSuccessStatusCode)
        {
            var msg = json.ValueKind == JsonValueKind.Object && json.TryGetProperty("error", out var err) ? err.GetString() : null;
            throw new InvalidOperationException(msg ?? $"Sign-in failed (HTTP {(int)res.StatusCode})");
        }

        var setCookie = res.Headers.TryGetValues("Set-Cookie", out var values) ? values.FirstOrDefault() : null;
        var pair = setCookie?.Split(';')[0].Split('=', 2);
        if (pair is not { Length: 2 }) throw new InvalidOperationException("The panel server did not start a session");
        var cm = web.CoreWebView2.CookieManager;
        var cookie = cm.CreateCookie(pair[0], pair[1], "127.0.0.1", "/");
        cookie.IsHttpOnly = true;
        cookie.SameSite = CoreWebView2CookieSameSiteKind.Strict;
        cm.AddOrUpdateCookie(cookie);

        // Keep the saved name in step with the sign-in profile, and remember when it was used.
        if (json.TryGetProperty("profiles", out var profiles))
        {
            foreach (var p in profiles.EnumerateArray())
            {
                if (p.TryGetProperty("login", out var login) && login.ValueKind == JsonValueKind.True && p.TryGetProperty("name", out var n))
                    saved.Name = n.GetString() ?? saved.Name;
            }
        }
        saved.LastUsedAt = SavedSignIns.Now();
        SavedSignIns.Save(saved);
        currentSavedId = saved.Id;
    }

    // ---------- links and downloads ----------

    static void OpenExternally(string uri)
    {
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" or "mailto")
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
    }

    void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsPanel(e.Uri) || e.Uri.StartsWith("about:") || e.Uri.StartsWith("data:") || e.Uri.StartsWith("blob:")) return;
        e.Cancel = true;
        OpenExternally(e.Uri);
    }

    // target=_blank and window.open go to the default browser.
    void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (IsPanel(e.Uri)) web.CoreWebView2.Navigate(e.Uri); else OpenExternally(e.Uri);
    }

    void OnDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var deferral = e.GetDeferral();
        // Show the dialog after this handler returns, so WebView2 isn't blocked inside its own event.
        BeginInvoke(() =>
        {
            using (deferral)
            {
                using var dlg = new SaveFileDialog
                {
                    FileName = Path.GetFileName(e.ResultFilePath),
                    InitialDirectory = Path.GetDirectoryName(e.ResultFilePath),
                    OverwritePrompt = true,
                };
                if (dlg.ShowDialog(this) != DialogResult.OK) { e.Cancel = true; return; }
                e.ResultFilePath = dlg.FileName;
                e.Handled = true; // no Edge download bubble; we say when it's done
                e.DownloadOperation.StateChanged += (_, _) =>
                {
                    if (e.DownloadOperation.State == CoreWebView2DownloadState.Completed) Notify("toast", "Download saved");
                    if (e.DownloadOperation.State == CoreWebView2DownloadState.Interrupted) Notify("toast", "Download failed");
                };
            }
        });
    }

    // ---------- window menu (Alt+Space, or right-click the title bar) ----------

    const int WM_SYSCOMMAND = 0x0112;
    const int MF_STRING = 0x0, MF_SEPARATOR = 0x800;
    const int ID_DATA = 0x1000, ID_FORGET = 0x1010, ID_ABOUT = 0x1020;

    [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr hWnd, bool revert);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool AppendMenu(IntPtr menu, int flags, int id, string? text);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        var menu = GetSystemMenu(Handle, false);
        AppendMenu(menu, MF_SEPARATOR, 0, null);
        AppendMenu(menu, MF_STRING, ID_DATA, "Show data folder");
        AppendMenu(menu, MF_STRING, ID_FORGET, "Forget all saved sign-ins…");
        AppendMenu(menu, MF_STRING, ID_ABOUT, $"About {App.Name}");
        // Dark title bar when Windows is in dark mode (Windows 11).
        var dark = App.SystemUsesDarkMode() ? 1 : 0;
        DwmSetWindowAttribute(Handle, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref dark, sizeof(int));
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_SYSCOMMAND)
        {
            switch ((int)m.WParam & 0xFFF0)
            {
                case ID_DATA: Process.Start(new ProcessStartInfo(App.DataDir) { UseShellExecute = true }); return;
                case ID_FORGET: ForgetAll(); return;
                case ID_ABOUT:
                    MessageBox.Show(this, $"{App.Name} {Application.ProductVersion.Split('+')[0]}\nControl panel for Telnyx Edge Compute.\n\nData: {App.DataDir}", $"About {App.Name}", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
            }
        }
        base.WndProc(ref m);
    }

    void ForgetAll()
    {
        var n = SavedSignIns.Load().Count;
        if (n == 0)
        {
            MessageBox.Show(this, "There are no saved sign-ins. Keys you choose to remember when signing in are kept in Windows Credential Manager.", App.Name);
            return;
        }
        var answer = MessageBox.Show(this,
            $"Forget {n} saved sign-in{(n == 1 ? "" : "s")}?\n\nThe keys are removed from Windows Credential Manager. Vaults and profiles stay on this PC and open again when you sign in with the same key.",
            App.Name, MessageBoxButtons.OKCancel, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.OK) return;
        SavedSignIns.DeleteAll();
        currentSavedId = null;
        Notify("saved-changed");
    }
}
