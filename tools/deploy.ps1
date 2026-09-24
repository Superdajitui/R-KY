# 一键发布到 GitHub Pages
#
# 做四件事：
#   1. 问你的 GitHub 用户名，据此把站点里的 og:image 等补成绝对地址
#   2. 打生产包到 docs/
#   3. 初始化 git 仓库并提交
#   4. 推到 GitHub
#
# 首次推送会弹出浏览器让你登录 GitHub（Git Credential Manager 负责，
# 不需要手动配 SSH key 或 token）。
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$REPO = 'R-KY'      # 仓库名，也是网址里的路径

function Line($t = '') { Write-Host $t }

Line ''
Line '  ══════════════════════════════════════════════'
Line '    发布到 GitHub Pages'
Line '  ══════════════════════════════════════════════'
Line ''

# ── 检查 git ─────────────────────────────────────────
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Line '  [!] 没有找到 git。请先安装 Git for Windows:'
    Line '      https://git-scm.com/download/win'
    Line ''
    Read-Host '  按回车键退出'
    exit 1
}

# ── 取用户名 ─────────────────────────────────────────
$remote = git remote get-url origin 2>$null
$guess = ''
if ($LASTEXITCODE -eq 0 -and $remote -match 'github\.com[:/]([^/]+)/') { $guess = $Matches[1] }

Line '  请输入你的 GitHub 用户名（不是邮箱，就是 github.com/ 后面那串）。'
if ($guess) { Line "  直接回车沿用上次的: $guess" }
Line ''
$user = Read-Host '  用户名'
if (-not $user) { $user = $guess }
if (-not $user) {
    Line ''
    Line '  [!] 用户名不能为空。'
    Read-Host '  按回车键退出'
    exit 1
}
$user = $user.Trim()

$siteUrl = "https://$user.github.io/$REPO"
Line ''
Line "  站点地址将是: $siteUrl"
Line ''

# ── 打生产包 ─────────────────────────────────────────
Line '  [1/4] 打包...'
& node tools/build.mjs $siteUrl
if ($LASTEXITCODE -ne 0) {
    Line '  [!] 打包失败。'
    Read-Host '  按回车键退出'
    exit 1
}

# ── git 初始化与提交 ─────────────────────────────────
Line ''
Line '  [2/4] 初始化 git 仓库...'
if (-not (Test-Path '.git')) {
    git init | Out-Null
    git branch -M main
    Line '        已创建新仓库'
} else {
    Line '        已有仓库，跳过'
}

# 没配身份的话 git 会拒绝提交，这里兜底填一个
$name = git config user.name 2>$null
if (-not $name) {
    git config user.name $user
    Line "        已设置 user.name = $user"
}
$mail = git config user.email 2>$null
if (-not $mail) {
    git config user.email "$user@users.noreply.github.com"
    Line "        已设置 user.email = $user@users.noreply.github.com"
}

Line ''
Line '  [3/4] 提交...'
git add -A
$staged = git diff --cached --name-only
if ($staged) {
    git commit -m "更新个人网站 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" | Out-Null
    Line "        已提交 $((($staged | Measure-Object).Count)) 个文件"
} else {
    Line '        没有改动需要提交'
}

# ── 推送 ─────────────────────────────────────────────
Line ''
Line '  [4/4] 推送到 GitHub...'

# 用 SSH 而不是 HTTPS，两个原因：
#   1. 这台机器上 Watt Toolkit 把 github.com 劫持到 127.0.0.1 做本地反代，
#      它的中间人证书过不了 git 的 schannel 吊销检查，HTTPS 会直接失败
#   2. ssh.github.com 不在劫持列表里，且走 443 端口，比 22 稳定得多
$remoteUrl = "ssh://git@ssh.github.com:443/$user/$REPO.git"
$existing = git remote get-url origin 2>$null
if ($LASTEXITCODE -eq 0) {
    git remote set-url origin $remoteUrl
} else {
    git remote add origin $remoteUrl
}

# 指定用哪把私钥；IdentitiesOnly 避免 ssh 拿别的密钥乱试
$keyPath = "$env:USERPROFILE\.ssh\id_ed25519_github"
if (-not (Test-Path $keyPath)) {
    Line ''
    Line "  [!] 没找到 SSH 密钥: $keyPath"
    Line '      这台机器上 GitHub 只能走 SSH（原因见 README 的「踩过的坑」），'
    Line '      请先运行一次:  tools\设置SSH密钥.bat'
    Line ''
    Read-Host '  按回车键退出'
    exit 1
}
git config core.sshCommand "ssh -i `"$($keyPath -replace '\\','/')`" -o IdentitiesOnly=yes"
Line "        远程仓库: $remoteUrl"

# stdin 接 NUL —— 否则 ssh 在非交互环境里可能一直卡在读标准输入
cmd /c "git push -u origin main < NUL"
$pushOk = ($LASTEXITCODE -eq 0)

Line ''
Line '  ──────────────────────────────────────────────'
if ($pushOk) {
    Line '   推送成功！'
    Line ''
    Line '   GitHub Pages 会在 1~2 分钟内自动重新构建。'
    Line "   站点地址:  $siteUrl"
    Line ''
    Line '   想确认是否更新成功，可以运行:'
    Line '     npm run verify:live'
} else {
    Line '   [!] 推送失败，常见原因：'
    Line ''
    Line "       - GitHub 上还没有创建仓库 $REPO"
    Line "         请先打开 https://github.com/new 新建，"
    Line "         名字填 $REPO，选 Public，不要勾选 README"
    Line '       - SSH 密钥没有添加到 GitHub 账号'
    Line '         运行 tools\设置SSH密钥.bat 按提示操作'
}
Line '  ──────────────────────────────────────────────'
Line ''
Read-Host '  按回车键退出'
