# NexusOn debug logunu masaustune kopyalar ve bir sonraki test temiz baslasin diye siler.
# Kullanim (PowerShell), NexusOn KAPALIYKEN:  .\log-al.ps1 -Etiket A-musteri
param(
    [Parameter(Mandatory = $true)]
    [string]$Etiket
)

if (Get-Process -Name NexusOn -ErrorAction SilentlyContinue) {
    Write-Host 'NexusOn hala acik. Once uygulamayi kapatin, sonra bu betigi tekrar calistirin.'
    exit 1
}

$log = Join-Path $env:TEMP 'nexuson-debug.log'
if (-not (Test-Path $log)) {
    Write-Host "Log bulunamadi: $log"
    exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$hedef = Join-Path ([Environment]::GetFolderPath('Desktop')) "nexuson-log-$Etiket-$stamp.txt"
Copy-Item $log $hedef
Remove-Item $log -Force
Write-Host "Log kopyalandi: $hedef"
Write-Host 'Bir sonraki testte yeni bir log olusacak.'
