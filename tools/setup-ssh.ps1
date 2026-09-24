# 生成 / 配置 GitHub SSH 密钥
#
# 为什么这台机器必须用 SSH 而不是 HTTPS：
#   Watt Toolkit（Steam++）会把 github.com 劫持到 127.0.0.1 做本地反代，
#   它的中间人证书过不了 git 的 schannel 吊销检查（CRYPT_E_NO_REVOCATION_CHECK），
#   HTTPS 推送必然失败。ssh.github.com 不在劫持列表里，且走 443 端口，稳定得多。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$keyPath = "$env:USERPROFILE\.ssh\id_ed25519_github"
$sshDir  = Split-Path -Parent $keyPath

function Line($t = '') { Write-Host $t }

Line ''
Line '  ══════════════════════════════════════════════'
Line '    配置 GitHub SSH 密钥'
Line '  ══════════════════════════════════════════════'
Line ''

if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
    Line '  [!] 没有找到 ssh-keygen。'
    Line '      Windows 10/11 自带 OpenSSH，可在「设置 → 应用 →'
    Line '      可选功能」里安装 "OpenSSH 客户端"。'
    Line ''
    Read-Host '  按回车键退出'
    exit 1
}

New-Item -ItemType Directory -Force -Path $sshDir | Out-Null

# ── 生成密钥（已存在则复用）─────────────────────────
if (Test-Path $keyPath) {
    Line '  密钥已存在，直接复用：'
    Line "    $keyPath"
} else {
    Line '  正在生成 ed25519 密钥...'
    # -N "" 表示不设口令，省去配置 ssh-agent 的麻烦
    ssh-keygen -t ed25519 -C "github@$env:COMPUTERNAME" -f $keyPath -N '""' | Out-Null
    if (-not (Test-Path $keyPath)) {
        Line '  [!] 生成失败。'
        Read-Host '  按回车键退出'
        exit 1
    }
    Line '  ✓ 已生成'
}
Line ''

# ── 公钥放进剪贴板 ───────────────────────────────────
$pub = (Get-Content "$keyPath.pub" -Raw).Trim()
Set-Clipboard -Value $pub

Line '  ──────────────────────────────────────────────'
Line '   你的公钥（已复制到剪贴板）：'
Line '  ──────────────────────────────────────────────'
Line ''
Line "  $pub"
Line ''
Line '  ──────────────────────────────────────────────'
Line '   接下来：'
Line '     1. 浏览器会自动打开 GitHub 的 SSH 密钥页面'
Line '     2. Title 随便填，比如「我的电脑」'
Line '     3. 点 Key 输入框，按 Ctrl+V 粘贴'
Line '     4. 点 Add SSH key'
Line '  ──────────────────────────────────────────────'
Line ''

Start-Process 'https://github.com/settings/ssh/new'

Read-Host '  添加完成后按回车，我来验证'

# ── 验证 ─────────────────────────────────────────────
Line ''
Line '  正在验证...'
$out = cmd /c "ssh -i `"$($keyPath -replace '\\','/')`" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new -p 443 git@ssh.github.com < NUL 2>&1"
$text = ($out | Out-String)

if ($text -match 'successfully authenticated') {
    Line '  ✓ 验证通过！现在可以运行 deploy-github.bat 发布了。'
} elseif ($text -match 'Permission denied') {
    Line '  ✗ 认证被拒绝 —— 公钥可能还没添加成功，或粘贴时漏了字符。'
    Line '    可以重新运行本脚本再试一次。'
} else {
    Line '  ? 无法确定结果，原始输出：'
    $out | Select-Object -First 5 | ForEach-Object { Line "    $_" }
}
Line ''
Read-Host '  按回车键退出'
