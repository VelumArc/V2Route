// SPDX-License-Identifier: GPL-3.0-or-later
// User-invoked installer. Never elevates, closes applications or schedules work.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

sealed class SetupSurface : Form {
    readonly Image brand;
    public SetupSurface(){
        DoubleBuffered=true;
        var assembly=Assembly.GetExecutingAssembly();
        using(var stream=assembly.GetManifestResourceStream("V2Route.Brand.png"))
        using(var source=Image.FromStream(stream))brand=new Bitmap(source);
        using(var stream=assembly.GetManifestResourceStream("V2Route.Brand.ico"))
        using(var source=new Icon(stream))Icon=(Icon)source.Clone();
    }
    protected override void Dispose(bool disposing){if(disposing){brand.Dispose();if(Icon!=null)Icon.Dispose();}base.Dispose(disposing);}
    public static GraphicsPath Rounded(Rectangle r,int radius){var p=new GraphicsPath();int d=radius*2;p.AddArc(r.Left,r.Top,d,d,180,90);p.AddArc(r.Right-d,r.Top,d,d,270,90);p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90);p.AddArc(r.Left,r.Bottom-d,d,d,90,90);p.CloseFigure();return p;}
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        using(var background=new LinearGradientBrush(ClientRectangle,Color.FromArgb(237,243,255),Color.FromArgb(230,226,255),35f))e.Graphics.FillRectangle(background,ClientRectangle);
        using(var pen=new Pen(Color.FromArgb(95,255,255,255),18)){e.Graphics.DrawArc(pen,new Rectangle(408,-180,450,430),25,270);e.Graphics.DrawArc(pen,new Rectangle(465,-158,350,350),25,270);}
        using(var card=Rounded(new Rectangle(24,128,ClientSize.Width-48,222),16))using(var brush=new SolidBrush(Color.White))using(var border=new Pen(Color.FromArgb(220,231,252))){e.Graphics.FillPath(brush,card);e.Graphics.DrawPath(border,card);}
        e.Graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;
        e.Graphics.PixelOffsetMode=PixelOffsetMode.HighQuality;
        e.Graphics.DrawImage(brand,new Rectangle(28,26,48,48));
    }
}
sealed class SetupAction : Button {
    public bool Primary;
    public SetupAction(){FlatStyle=FlatStyle.Flat;FlatAppearance.BorderSize=0;Cursor=Cursors.Hand;BackColor=Color.Transparent;UseVisualStyleBackColor=false;}
    protected override void OnPaint(PaintEventArgs e){
        e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
        var bounds=new Rectangle(1,1,Width-3,Height-3);
        Color fill=Enabled?(Primary?Color.FromArgb(37,86,195):Color.White):Color.FromArgb(225,232,240);
        using(var path=SetupSurface.Rounded(bounds,10))using(var brush=new LinearGradientBrush(bounds,Enabled&&Primary?Color.FromArgb(51,111,230):fill,fill,25f))using(var pen=new Pen(Primary?fill:Color.FromArgb(216,230,255))){e.Graphics.FillPath(brush,path);e.Graphics.DrawPath(pen,path);}
        TextRenderer.DrawText(e.Graphics,Text,Font,bounds,Enabled?(Primary?Color.White:Color.FromArgb(45,94,181)):Color.FromArgb(125,140,155),TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);
        if(Focused)ControlPaint.DrawFocusRectangle(e.Graphics,new Rectangle(5,5,Width-11,Height-11),Primary?Color.White:Color.FromArgb(45,94,181),fill);
    }
}

static class SetupLauncher {
    const string Version="1.2.43";
    const string Payload="V2Route.Payload.zip";
    static bool Embedded { get { return Array.IndexOf(Assembly.GetExecutingAssembly().GetManifestResourceNames(),Payload)>=0; } }
    static string Base { get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar); } }
    static void AssertPlainDirectory(string path) {
        DirectoryInfo p=new DirectoryInfo(Path.GetFullPath(path));
        while(p!=null) { if(p.Exists && (p.Attributes & FileAttributes.ReparsePoint)!=0) throw new IOException("Linked installation paths are not supported / 请选择非链接目录。"); p=p.Parent; }
    }
    static int Extract(string target) {
        target=Path.GetFullPath(target);AssertPlainDirectory(target);
        if(Directory.Exists(target) && Directory.GetFileSystemEntries(target).Length!=0) throw new IOException("Choose an empty folder; existing files will be preserved / 请选择空文件夹，已有文件不会覆盖。");
        Directory.CreateDirectory(target); string prefix=target.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar; int files=0;
        using(Stream stream=Assembly.GetExecutingAssembly().GetManifestResourceStream(Payload)) {
            if(stream==null)throw new IOException("This helper belongs beside the extracted package / 请将此入口保留在完整解压目录中。");
            using(ZipArchive zip=new ZipArchive(stream,ZipArchiveMode.Read)) foreach(ZipArchiveEntry entry in zip.Entries) {
                if(!entry.FullName.StartsWith("V2Route/",StringComparison.Ordinal))throw new IOException("Invalid package root");
                string relative=entry.FullName.Substring(8);
                if(relative.Length==0)continue;
                if(relative.Contains("\\")||relative.Contains(":"))throw new IOException("Invalid package path");
                string output=Path.GetFullPath(Path.Combine(target,relative.Replace('/',Path.DirectorySeparatorChar)));
                if(!output.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new IOException("Package path escapes destination");
                if(entry.FullName.EndsWith("/")) {Directory.CreateDirectory(output);continue;}
                Directory.CreateDirectory(Path.GetDirectoryName(output));AssertPlainDirectory(Path.GetDirectoryName(output));
                using(Stream source=entry.Open())using(FileStream destination=new FileStream(output,FileMode.CreateNew,FileAccess.Write,FileShare.None))source.CopyTo(destination);
                files++;
            }
        }
        return files;
    }
    static void CheckBundle(string root) {
        foreach(string name in new[]{"runtime/python.exe","setup.py","cores/xray/xray.exe","chrome-extension/manifest.json","native/V2RouteHost.exe"})
            if(!File.Exists(Path.Combine(root,name.Replace('/',Path.DirectorySeparatorChar))))throw new IOException("Incomplete package / 完整包缺少："+name);
    }
    static string RunSetup(string root,string arguments) {
        CheckBundle(root);
        var info=new ProcessStartInfo(Path.Combine(root,"runtime\\python.exe"),"-I -X utf8 \""+Path.Combine(root,"setup.py")+"\" "+arguments);
        info.WorkingDirectory=root;info.UseShellExecute=false;info.CreateNoWindow=true;info.WindowStyle=ProcessWindowStyle.Hidden;
        info.RedirectStandardOutput=true;info.RedirectStandardError=true;info.StandardOutputEncoding=Encoding.UTF8;info.StandardErrorEncoding=Encoding.UTF8;
        using(Process process=Process.Start(info)) {
            Task<string> stdout=process.StandardOutput.ReadToEndAsync(),stderr=process.StandardError.ReadToEndAsync();
            process.WaitForExit();Task.WaitAll(stdout,stderr);
            if(process.ExitCode!=0)throw new IOException("Setup failed / 安装未完成：\r\n"+stderr.Result+"\r\n"+stdout.Result);
            return stdout.Result;
        }
    }
    static Dictionary<string,object> UpgradePlan(string root) {
        string raw=RunSetup(root,"--upgrade-plan");
        var plan=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(raw);
        if(plan==null || !plan.ContainsKey("required") || !(plan["required"] is bool))throw new IOException("Invalid upgrade plan / 升级计划无效，未安装。");
        return plan;
    }
    [STAThread] static int Main(string[] args) {
        try {
            // Reproducible package inspection: never registers or opens a window.
            if(args.Length==2 && args[0]=="--extract-test") {Extract(args[1]);CheckBundle(args[1]);return 0;}
            if(args.Length==1 && args[0]=="--check") {if(!Embedded)CheckBundle(Base);return 0;}
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            var form=new SetupSurface {Text="Proxy V2Route · 安装本地组件",ClientSize=new Size(680,450),StartPosition=FormStartPosition.CenterScreen,Font=new Font("Segoe UI",10),BackColor=Color.FromArgb(237,243,255),FormBorderStyle=FormBorderStyle.FixedDialog,MaximizeBox=false};
            var heading=new Label {Text="Proxy V2Route",Font=new Font("Segoe UI",25,FontStyle.Bold),ForeColor=Color.FromArgb(27,49,98),Location=new Point(82,27),AutoSize=true,BackColor=Color.Transparent};
            var version=new Label {Text=Version+"  ·  WINDOWS COMPANION",Font=new Font("Segoe UI",8),ForeColor=Color.FromArgb(45,94,181),Location=new Point(86,71),AutoSize=true,BackColor=Color.Transparent};
            var hint=new Label {Text="让浏览器连接你的线路  /  Connect your browser to your routes",Location=new Point(30,100),Size=new Size(620,24),ForeColor=Color.FromArgb(82,102,133),BackColor=Color.Transparent};
            string defaultRoot=Directory.Exists("E:\\")?Path.Combine("E:\\V2Route",Version):Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Programs","V2Route",Version);
            var pathLabel=new Label {Text="安装位置 / Install location",Location=new Point(44,151),Size=new Size(560,24),BackColor=Color.White,ForeColor=Color.FromArgb(27,49,98)};
            var location=new TextBox {Text=Embedded?defaultRoot:Base,ReadOnly=!Embedded,Location=new Point(44,187),Size=new Size(460,28),BackColor=Color.FromArgb(245,249,255),ForeColor=Color.FromArgb(27,49,98)};
            var browse=new SetupAction {Text="浏览 / Browse",Location=new Point(516,179),Size=new Size(119,40),Enabled=Embedded};
            browse.Click+=(s,e)=>{using(var dialog=new FolderBrowserDialog {Description="Select a new empty installation folder / 选择新的空安装目录",SelectedPath=location.Text,ShowNewFolderButton=true})if(dialog.ShowDialog(form)==DialogResult.OK)location.Text=dialog.SelectedPath;};
            var status=new Label {Text="自动配置代理核心与本地连接，并扫描 v2rayN。\r\n也可独立导入节点，无需安装 v2rayN。\r\nAutomatic setup and discovery. Imported nodes work independently.",Location=new Point(44,242),Size=new Size(590,88),BackColor=Color.White,ForeColor=Color.FromArgb(82,102,133)};
            var install=new SetupAction {Text="安装并连接 / Install",Primary=true,Location=new Point(426,378),Size=new Size(230,44),Font=new Font("Segoe UI",11,FontStyle.Bold)};
            var footer=new Label {Text="为当前 Windows 用户安装\r\n无需关闭浏览器 · 不更改系统代理",Location=new Point(30,382),Size=new Size(360,42),Font=new Font("Segoe UI",9),ForeColor=Color.FromArgb(82,102,133),BackColor=Color.Transparent};
            var done=false;var working=false;string preparedTarget=null;
            form.FormClosing+=(s,e)=>{if(working)e.Cancel=true;};
            install.Click+=async(s,e)=>{
                if(done){form.Close();return;}if(working)return;working=true;install.Enabled=false;browse.Enabled=false;location.ReadOnly=true;
                status.Text="正在安装并扫描本地线路… / Installing and discovering local routes…";
                try {
                    string target=Path.GetFullPath(location.Text);
                    if(Embedded && !String.Equals(preparedTarget,target,StringComparison.OrdinalIgnoreCase)) {await Task.Run(()=>Extract(target));preparedTarget=target;}
                    var plan=await Task.Run(()=>UpgradePlan(target));bool upgrade=(bool)plan["required"];
                    if(upgrade) {
                        string previous=Convert.ToString(plan["source"]);
                        string message="检测到已安装的 Proxy V2Route：\r\n"+previous+"\r\n\r\n将保留导入节点、情景线路绑定和本地端口，更新本地组件连接。\r\n仅 Proxy V2Route 的代理连接会短暂中断；不会退出浏览器或更改 v2rayN 主线路。\r\n\r\nPreserve imported nodes and route bindings, then restart the Proxy V2Route companion.\r\nProxy V2Route connections may briefly interrupt. Continue?";
                        var warnings=plan.ContainsKey("warnings")?plan["warnings"] as System.Collections.IEnumerable:null;
                        if(warnings!=null)foreach(object warning in warnings)message+="\r\n\r\n"+Convert.ToString(warning);
                        if(MessageBox.Show(form,message,"Proxy V2Route · 确认升级 / Review upgrade",MessageBoxButtons.OKCancel,MessageBoxIcon.Information)!=DialogResult.OK) {
                            status.Text="已取消安装，现有版本保留。\r\nInstallation cancelled. Existing installation preserved.";browse.Enabled=Embedded;location.ReadOnly=!Embedded;return;
                        }
                    }
                    await Task.Run(()=>RunSetup(target,upgrade?"--install --upgrade":"--install"));
                    done=true;status.Text="安装完成。返回扩展继续使用。\r\nInstalled. Return to Proxy V2Route to continue.\r\nChrome 本地加载目录："+Path.Combine(target,"chrome-extension");install.Text="完成 / Done";
                }
                catch(Exception ex){status.Text="未完成 / Not completed";MessageBox.Show(form,ex.Message,"Proxy V2Route",MessageBoxButtons.OK,MessageBoxIcon.Error);browse.Enabled=Embedded;location.ReadOnly=!Embedded;}
                finally{working=false;install.Enabled=true;}
            };
            form.Controls.AddRange(new Control[]{heading,version,hint,pathLabel,location,browse,status,footer,install});form.ActiveControl=install;
            if(args.Length==2 && args[0]=="--preview") {location.Text=Path.Combine("C:\\Apps","Proxy-V2Route",Version);form.ShowInTaskbar=false;form.StartPosition=FormStartPosition.Manual;form.Location=new Point(-32000,-32000);form.Show();Application.DoEvents();using(var bitmap=new Bitmap(form.Width,form.Height)){form.DrawToBitmap(bitmap,new Rectangle(0,0,bitmap.Width,bitmap.Height));bitmap.Save(args[1],System.Drawing.Imaging.ImageFormat.Png);}form.Close();form.Dispose();return 0;}
            Application.Run(form);return done?0:1;
        }catch(Exception ex){if(args.Length>0){Console.Error.WriteLine(ex.Message);return 1;}MessageBox.Show(ex.Message,"Proxy V2Route",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
