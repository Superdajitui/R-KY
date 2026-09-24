# 个人网站本地预览 —— 启动脚本
# 说明：批处理(.bat)对中文支持有缺陷（cmd.exe 按字节偏移读文件，
#       多字节字符可能被切在中间导致命令行错乱），所以中文逻辑全部放在
#       这个 PowerShell 脚本里，外层 .bat 只做纯 ASCII 跳板。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$PORT = 4321

function Write-Line($t = '') { Write-Host $t }

Write-Line ''
Write-Line '  ══════════════════════════════════════════════'
Write-Line '    任恺昱 · 个人网站'
Write-Line '  ══════════════════════════════════════════════'
Write-Line ''

# ── 检查 Node ────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Line '  [!] 没有找到 Node.js，无法启动预览服务。'
    Write-Line '      安装 Node.js 后重试，或直接双击 index.html'
    Write-Line '      (直接打开会因浏览器安全策略丢失自定义字体)。'
    Write-Line ''
    Read-Host '  按回车键退出'
    exit 1
}

# ── 服务是否已在运行 ─────────────────────────────────
$listening = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Write-Line '  正在启动预览服务...'
    Start-Process -FilePath 'cmd.exe' `
        -ArgumentList '/c', "title 个人网站预览服务 && node `"tools\serve.mjs`" $PORT" `
        -WorkingDirectory $root -WindowStyle Minimized
    Start-Sleep -Seconds 3
} else {
    Write-Line '  预览服务已在运行。'
}

# ── 取局域网 IP（排除回环与 VPN）─────────────────────
$lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
        $_.IPAddress -ne '127.0.0.1' -and
        $_.PrefixOrigin -ne 'WellKnown' -and
        $_.InterfaceAlias -notlike '*VPN*' -and
        $_.IPAddress -notlike '169.254.*'
    } | Select-Object -First 1 -ExpandProperty IPAddress

Write-Line ''
Write-Line '  ──────────────────────────────────────────────'
Write-Line "    本机打开:      http://127.0.0.1:$PORT/"
if ($lanIp) {
    Write-Line "    手机 / 平板:   http://${lanIp}:$PORT/"
    Write-Line '                   (手机需连同一个 Wi-Fi)'
} else {
    Write-Line '    手机 / 平板:   未检测到局域网地址'
}
Write-Line '  ──────────────────────────────────────────────'

# ── 防火墙检查 ───────────────────────────────────────
$rule = netsh advfirewall firewall show rule name="个人网站预览 $PORT" 2>&1
$ruleMissing = ($LASTEXITCODE -ne 0) -or ($rule -match '没有与指定条件相匹配的规则|No rules match')

if ($ruleMissing -and $lanIp) {
    Write-Line ''
    Write-Line '  [!] 还没有放行防火墙，手机 / 平板可能连不上。'
    Write-Line '      请以管理员身份运行一次:  tools\放行防火墙.bat'
}

# ── 打开浏览器 ───────────────────────────────────────
Start-Process "http://127.0.0.1:$PORT/"
Write-Line ''
Write-Line '  已在浏览器打开。关闭那个最小化的「个人网站预览服务」'
Write-Line '  窗口即可停止服务。'
Write-Line ''
Start-Sleep -Seconds 5
