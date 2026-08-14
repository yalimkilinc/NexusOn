# Kalici yardimci surec: stdin'den satir satir gelen tek karakterleri
# GERCEK/TAM UTF-16 kod birimiyle (kirpma OLMADAN) SendInput+KEYEVENTF_UNICODE
# ile enjekte eder. nut-js'in native typeString() fonksiyonunun Latin
# Extended-A karakterlerde (U+0100 ustu, ornegin Turkce g,s,i,I) kod noktasini
# 8 bite kirptigi CANLI KANITLANDI (g=U+011F -> dusuk bayt 0x1F, vs.) - bu,
# .NET'in P/Invoke ile doğrudan cagirdigi ayni Win32 API'nin TAM/dogru
# kullanimidir.
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class UnicodeTyper {
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // Win32'nin GERCEK INPUT birligi (union) MOUSEINPUT'u da icerir - o,
    // KEYBDINPUT'tan BUYUK (daha fazla alan). Union'i sadece KEYBDINPUT ile
    // tanimlarsak struct boyutu Windows'un beklediginden KUCUK cikiyor,
    // SendInput da cbSize dogrulamasinda bunu SESSIZCE reddedip 0 donuyor
    // (yonetilen bir istisna FIRLATMIYOR - CANLI KANITLANDI, tam bu yuzden
    // "OK" yaniti geldi ama hicbir sey yazilmadi). Dogru boyut icin
    // MOUSEINPUT'u da (kullanilmasa bile) union'a ekliyoruz.
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT {
        public uint type;
        public INPUTUNION u;
    }

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_UNICODE = 0x0004;
    const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public static uint TypeChar(ushort codeUnit) {
        INPUT[] inputs = new INPUT[2];
        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].u.ki = new KEYBDINPUT { wVk = 0, wScan = codeUnit, dwFlags = KEYEVENTF_UNICODE, time = 0, dwExtraInfo = IntPtr.Zero };
        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].u.ki = new KEYBDINPUT { wVk = 0, wScan = codeUnit, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
        uint sent = SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
        return sent;
    }

    public static int StructSize() { return Marshal.SizeOf(typeof(INPUT)); }
}
"@

[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Ilk satirdan once "READY" yaz - Add-Type'in JIT derlemesi bitince nut-
# worker.js bunu bekleyip surecin gercekten hazir oldugundan emin olabilir.
[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    foreach ($ch in $line.ToCharArray()) {
        [UnicodeTyper]::TypeChar([uint16]$ch) | Out-Null
    }
    [Console]::Out.WriteLine("OK")
    [Console]::Out.Flush()
}
