# 放行 Windows 防火墙 —— 让手机 / 平板能访问本地预览服务
#
# 背景：只把服务绑到 127.0.0.1 的话，局域网其他设备根本连不上；
#       绑到 0.0.0.0 之后，还需要防火墙放行入站，否则同样连不上。
#       本机网络若被识别为「公用网络」，Windows 默认阻止一切入站连接，
#       而且不会弹「是否允许」的提示，所以必须手动加规则。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PORT = 4321
$RULE = "个人网站预览 $PORT"

# ── 需要管理员权限，没有就自我提权 ───────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ''
    Write-Host '  添加防火墙规则需要管理员权限。'
    Write-Host '  马上会弹出授权窗口，请点「是」。'
    Write-Host ''
    Start-Sleep -Seconds 2
    Start-Process powershell.exe -Verb RunAs -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$PSCommandPath`""
    )
    exit
}

Write-Host ''
Write-Host '  ──────────────────────────────────────────────'
Write-Host "   放行 TCP $PORT 入站（个人网站本地预览用）"
Write-Host '  ──────────────────────────────────────────────'
Write-Host ''

netsh advfirewall firewall delete rule name="$RULE" | Out-Null
netsh advfirewall firewall add rule name="$RULE" dir=in action=allow protocol=TCP localport=$PORT profile=any | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host '  完成。现在同一 Wi-Fi 下的手机、平板都能打开了。'
    Write-Host ''
    $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -ne '127.0.0.1' -and
            $_.PrefixOrigin -ne 'WellKnown' -and
            $_.InterfaceAlias -notlike '*VPN*'
        } | Select-Object -First 1 -ExpandProperty IPAddress
    if ($lanIp) { Write-Host "  访问地址:  http://${lanIp}:$PORT/" }
    Write-Host ''
    Write-Host '  想撤销这条规则，以管理员身份运行:'
    Write-Host "    netsh advfirewall firewall delete rule name=`"$RULE`""
} else {
    Write-Host '  添加失败。请确认在授权窗口点了「是」。'
}

Write-Host ''
Read-Host '  按回车键退出'
