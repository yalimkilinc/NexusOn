# NexusOn yakalama/kodlama ayarini degistirir (yeniden kurulum gerekmez).
# Kullanim (PowerShell):  .\tuning-ayarla.ps1 -Mod A
#   A   = 1.1.1 ayari (contentHint yok, maintain-resolution, 2,5 Mbps)  <- varsayilan
#   B   = A + contentHint=detail
#   C   = A + balanced encoder (8 Mbps, 30 fps)
#   D   = B + C  (1.2.1'deki ayar)
#   SIL = tuning.json'i siler (varsayilan A davranisi)
# Ayar uygulama ACILIRKEN okunur: degistirdikten sonra NexusOn'u kapatip yeniden acin.
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('A', 'B', 'C', 'D', 'SIL')]
    [string]$Mod
)

$dir = Join-Path $env:APPDATA 'nexuson'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir 'tuning.json'

switch ($Mod) {
    'A' { $json = '{"contentHint":"","balancedEncoder":false,"diagnostics":true}' }
    'B' { $json = '{"contentHint":"detail","balancedEncoder":false,"diagnostics":true}' }
    'C' { $json = '{"contentHint":"","balancedEncoder":true,"diagnostics":true}' }
    'D' { $json = '{"contentHint":"detail","balancedEncoder":true,"diagnostics":true}' }
    'SIL' {
        if (Test-Path $file) { Remove-Item $file -Force }
        Write-Host 'tuning.json silindi (varsayilan A davranisi).'
        return
    }
}

[System.IO.File]::WriteAllText($file, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Mod $Mod yazildi: $file"
Write-Host $json
Write-Host 'NexusOn uygulamasini KAPATIP yeniden acin. Acilista debug logunda [tuning] satiri bu ayari gostermelidir.'
