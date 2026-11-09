$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path   # androidApp/
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$appApk = Join-Path $root 'build\outputs\apk\debug\androidApp-debug.apk'
$testApk = Join-Path $root 'build\outputs\apk\androidTest\debug\androidApp-debug-androidTest.apk'
$mediaDir = Join-Path $root 'build\test-medya'

# Test medyası: her klip ayırt edilebilir bir ton taşır (klip2 660 Hz, klip1 440 Hz, müzik 220+330 Hz).
if (!(Test-Path (Join-Path $mediaDir 'muzik.m4a'))) {
    New-Item -ItemType Directory -Force -Path $mediaDir | Out-Null
    $ff = @('-hide_banner', '-loglevel', 'error', '-y')
    ffmpeg @ff -f lavfi -i 'testsrc2=size=1080x1920:rate=30:duration=8' -f lavfi -i 'sine=frequency=440:duration=8' -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest (Join-Path $mediaDir 'klip1.mp4')
    ffmpeg @ff -f lavfi -i 'smptebars=size=1080x1920:rate=30:duration=6' -f lavfi -i 'sine=frequency=660:duration=6' -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest (Join-Path $mediaDir 'klip2.mp4')
    ffmpeg @ff -f lavfi -i 'mandelbrot=size=1920x1080:rate=30' -f lavfi -i 'sine=frequency=880:duration=7' -t 7 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest (Join-Path $mediaDir 'klip3_yatay.mp4')
    ffmpeg @ff -f lavfi -i 'sine=frequency=220:duration=30,volume=0.5' -f lavfi -i 'sine=frequency=330:duration=30,volume=0.3' -filter_complex amix=inputs=2 -c:a aac (Join-Path $mediaDir 'muzik.m4a')
}
$applicationId = 'io.github.saldraykee22.popi'
$deviceMedia = "/sdcard/Android/data/$applicationId/files/medya"
$outDir = Join-Path $root 'cikti'
$pulled = Join-Path $outDir 'export.mp4'

foreach ($path in @($adb, $appApk, $testApk)) {
    if (!(Test-Path -LiteralPath $path)) { throw "Gerekli dosya bulunamadı: $path" }
}
foreach ($name in @('klip1.mp4', 'klip2.mp4', 'klip3_yatay.mp4', 'muzik.m4a')) {
    if (!(Test-Path -LiteralPath (Join-Path $mediaDir $name))) { throw "Test medyası bulunamadı: $name" }
}
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

& $adb install -r $appApk
if ($LASTEXITCODE -ne 0) { throw "adb install app başarısız: $LASTEXITCODE" }
& $adb install -r $testApk
if ($LASTEXITCODE -ne 0) { throw "adb install androidTest başarısız: $LASTEXITCODE" }
# İlk açılış klasörü uygulamanın kendi UID'siyle oluşturur.
& $adb shell pm clear $applicationId | Out-Null
& $adb shell am start -W -n "$applicationId/.MainActivity" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Uygulama açılamadı: $LASTEXITCODE" }
& $adb shell am force-stop $applicationId
foreach ($name in @('klip1.mp4', 'klip2.mp4', 'klip3_yatay.mp4', 'muzik.m4a')) {
    & $adb push (Join-Path $mediaDir $name) "$deviceMedia/$name"
    if ($LASTEXITCODE -ne 0) { throw "adb push başarısız: $name ($LASTEXITCODE)" }
}

$instr = & $adb shell am instrument -w -r "$applicationId.test/androidx.test.runner.AndroidJUnitRunner"
$instr
if (-not ($instr -match '^OK \(')) { throw 'Instrumented test başarısız' }
& $adb pull "/sdcard/Android/data/$applicationId/files/cikti/export.mp4" $pulled
if ($LASTEXITCODE -ne 0) { throw "Export MP4 adb pull başarısız: $LASTEXITCODE" }

$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
if (!$ffprobe) { throw 'ffprobe PATH üzerinde bulunamadı.' }
& $ffprobe.Source -v error -show_entries 'stream=codec_type,width,height,duration:format=duration' -of default=noprint_wrappers=1 $pulled
if ($LASTEXITCODE -ne 0) { throw "ffprobe başarısız: $LASTEXITCODE" }

# Beklenen dalga bantlarını koruyan POC doğrulaması.
function BandDb($f, $ss, $t) {
    $r = ffmpeg -hide_banner -ss $ss -t $t -i $pulled -af "bandpass=f=${f}:width_type=q:w=8,volumedetect" -f null - 2>&1 | Select-String 'mean_volume: (-?[\d.]+)'
    [double]$r.Matches[0].Groups[1].Value
}
$kontroller = @(
    @{ad = 'klip2 sesi 0-5 sn'; f = 660; ss = 0; t = 5},
    @{ad = 'klip1 sesi 7-10 sn'; f = 440; ss = 7; t = 3},
    @{ad = 'müzik 0-5 sn'; f = 220; ss = 0; t = 5}
)
foreach ($k in $kontroller) {
    $db = BandDb $k.f $k.ss $k.t
    "$($k.ad): $db dB"
    if ($db -lt -50) { throw "Ses kontrolü başarısız: $($k.ad) duyulmuyor ($db dB)" }
}
