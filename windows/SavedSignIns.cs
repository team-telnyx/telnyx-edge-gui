// Saved sign-ins live in Windows Credential Manager, one generic credential
// per key ("TelnyxEdge/<id>"), so they show up (and can be removed) under
// Control Panel → Credential Manager → Windows Credentials.

using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace TelnyxEdge;

sealed class SavedSignIn
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string ApiKey { get; set; } = "";
    public double AddedAt { get; set; }
    public double? LastUsedAt { get; set; }

    public string Hint => "…" + (ApiKey.Length > 4 ? ApiKey[^4..] : ApiKey);

    /// What the page may see: never the key itself.
    public object ForPage() => new { id = Id, name = Name, hint = Hint, addedAt = AddedAt, lastUsedAt = LastUsedAt };
}

static class SavedSignIns
{
    public static readonly string Prefix = (Environment.GetEnvironmentVariable("EDGE_CP_CREDENTIAL_PREFIX") ?? "TelnyxEdge") + "/";

    record Secret(string ApiKey, double AddedAt, double? LastUsedAt);

    public static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// All saved sign-ins, most recently used first.
    public static List<SavedSignIn> Load()
    {
        var list = new List<SavedSignIn>();
        if (!CredEnumerate(Prefix + "*", 0, out var count, out var items))
        {
            var err = Marshal.GetLastWin32Error();
            if (err == ERROR_NOT_FOUND) return list;
            throw new Win32Exception(err);
        }
        try
        {
            for (var i = 0; i < count; i++)
            {
                var c = Marshal.PtrToStructure<CREDENTIAL>(Marshal.ReadIntPtr(items, i * IntPtr.Size));
                if (c.CredentialBlobSize == 0) continue;
                var bytes = new byte[c.CredentialBlobSize];
                Marshal.Copy(c.CredentialBlob, bytes, 0, bytes.Length);
                var secret = JsonSerializer.Deserialize<Secret>(Encoding.UTF8.GetString(bytes));
                if (secret is null) continue;
                list.Add(new SavedSignIn
                {
                    Id = c.TargetName[Prefix.Length..],
                    Name = c.UserName ?? "Default",
                    ApiKey = secret.ApiKey,
                    AddedAt = secret.AddedAt,
                    LastUsedAt = secret.LastUsedAt,
                });
            }
        }
        finally { CredFree(items); }
        return list.OrderByDescending(s => s.LastUsedAt ?? s.AddedAt).ToList();
    }

    public static void Save(SavedSignIn s)
    {
        var blob = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new Secret(s.ApiKey, s.AddedAt, s.LastUsedAt)));
        var ptr = Marshal.AllocHGlobal(blob.Length);
        try
        {
            Marshal.Copy(blob, 0, ptr, blob.Length);
            var c = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC,
                TargetName = Prefix + s.Id,
                Comment = "Telnyx Edge saved sign-in",
                CredentialBlobSize = (uint)blob.Length,
                CredentialBlob = ptr,
                Persist = CRED_PERSIST_LOCAL_MACHINE, // this user, this PC; not roamed
                UserName = s.Name,
            };
            if (!CredWrite(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    public static void Delete(string id)
    {
        if (!CredDelete(Prefix + id, CRED_TYPE_GENERIC, 0))
        {
            var err = Marshal.GetLastWin32Error();
            if (err != ERROR_NOT_FOUND) throw new Win32Exception(err);
        }
    }

    public static void DeleteAll()
    {
        foreach (var s in Load()) Delete(s.Id);
    }

    // ---------- advapi32 ----------

    const uint CRED_TYPE_GENERIC = 1;
    const uint CRED_PERSIST_LOCAL_MACHINE = 2;
    const int ERROR_NOT_FOUND = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias;
        public string? UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredEnumerate(string filter, uint flags, out int count, out IntPtr credentials);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll")]
    static extern void CredFree(IntPtr buffer);
}
