// Runs the panel's Node server on a private loopback port.

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace TelnyxEdge;

sealed class PanelServer : IDisposable
{
    public int Port { get; } = FreePort();
    public Uri Base => new($"http://127.0.0.1:{Port}/");
    public event Action<int>? Died;

    Process? process;

    static int FreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        var port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    /// Bundled node.exe first; a system Node only as a fallback for development builds.
    static string? FindNode()
    {
        var bundled = Path.Combine(AppContext.BaseDirectory, "node", "node.exe");
        if (File.Exists(bundled)) return bundled;
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var candidate = Path.Combine(dir.Trim(), "node.exe");
            if (dir.Length > 0 && File.Exists(candidate)) return candidate;
        }
        return null;
    }

    public async Task StartAsync()
    {
        var node = FindNode() ?? throw new InvalidOperationException("The app is missing its bundled Node.js (node\\node.exe). Reinstall Telnyx Edge.");
        var serverJs = Path.Combine(AppContext.BaseDirectory, "server", "server.js");
        if (!File.Exists(serverJs)) throw new InvalidOperationException("The app is missing its server files. Reinstall Telnyx Edge.");
        Directory.CreateDirectory(App.DataDir);

        var psi = new ProcessStartInfo(node)
        {
            ArgumentList = { serverJs },
            WorkingDirectory = Path.GetDirectoryName(serverJs)!,
            UseShellExecute = false,
            CreateNoWindow = true,
            // We hold stdin open; when this app exits, even by crashing, it closes and the server exits.
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.Environment["PORT"] = Port.ToString();
        psi.Environment["HOST"] = "127.0.0.1";
        psi.Environment["EDGE_CP_DATA_DIR"] = App.DataDir;
        psi.Environment["EDGE_CP_EXIT_WITH_PARENT"] = "1";

        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var errors = new System.Text.StringBuilder();
        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        p.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            App.Log(e.Data);
            if (e.Data.Contains("Control Panel on")) ready.TrySetResult();
        };
        p.ErrorDataReceived += (_, e) => { if (e.Data is null) return; App.Log(e.Data); lock (errors) errors.AppendLine(e.Data); };
        p.Exited += (_, _) =>
        {
            if (!ready.Task.IsCompleted)
            {
                string detail;
                lock (errors) detail = errors.ToString().Trim();
                ready.TrySetException(new InvalidOperationException($"The panel server stopped during start-up (exit code {p.ExitCode}).{(detail.Length > 0 ? "\n\n" + detail : "")}"));
            }
            else if (process is not null) Died?.Invoke(p.ExitCode);
        };
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        process = p;

        var winner = await Task.WhenAny(ready.Task, Task.Delay(TimeSpan.FromSeconds(30)));
        if (winner != ready.Task) throw new TimeoutException("The panel server did not start within 30 seconds.");
        await ready.Task;
    }

    public void Dispose()
    {
        var p = process;
        process = null; // a deliberate stop is not a crash
        if (p is null || p.HasExited) return;
        try { p.StandardInput.Close(); } catch { /* already gone */ }
        if (!p.WaitForExit(2000)) try { p.Kill(entireProcessTree: true); } catch { /* already gone */ }
    }
}
