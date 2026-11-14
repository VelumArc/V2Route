using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

internal static class NativeHost
{
    // GPL-3.0-or-later. Relative paths; no shell or target-machine compiler.
    private static string Quote(string value)
    {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value)
        {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { output.Append('\\', slashes * 2 + 1); output.Append(ch); slashes = 0; continue; }
            output.Append('\\', slashes); slashes = 0; output.Append(ch);
        }
        output.Append('\\', slashes * 2); output.Append('"');
        return output.ToString();
    }
    private static void Pump(Stream input, Stream output)
    {
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
        {
            output.Write(buffer, 0, read);
            // Native Messaging requests are short and Chrome keeps stdin open.
            // Do not retain a partial FileStream buffer until EOF/another frame.
            output.Flush();
        }
    }
    public static int Main(string[] args)
    {
        if (args.Length < 1 || args.Length > 4) return 2;
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            string python = Path.Combine(root, "runtime", "python.exe");
            string script = Path.Combine(root, "native_host.py");
            if (!File.Exists(python) || !File.Exists(script)) { Console.Error.WriteLine("V2Route companion files are incomplete."); return 3; }
            var command = new StringBuilder("-I -u "); command.Append(Quote(script));
            foreach (string value in args) { command.Append(' '); command.Append(Quote(value)); }
            var start = new ProcessStartInfo(python, command.ToString());
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardInput = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.WorkingDirectory = root;
            using (var child = Process.Start(start))
            {
                var incoming = new Thread(() => {
                    try { Pump(Console.OpenStandardInput(), child.StandardInput.BaseStream); }
                    catch (IOException) {} catch (ObjectDisposedException) {}
                    finally { try { child.StandardInput.Close(); } catch {} }
                });
                incoming.IsBackground = true;
                incoming.Start();
                var errors = new Thread(() => {
                    try { Pump(child.StandardError.BaseStream, Console.OpenStandardError()); } catch {}
                });
                errors.IsBackground = true;
                errors.Start();
                Pump(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error) { Console.Error.WriteLine("V2Route native launcher failed: " + error.Message); return 1; }
    }
}
