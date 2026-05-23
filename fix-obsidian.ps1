# ============================================
# Obsidian 彻底修复脚本
# 问题：Obsidian卡在启动界面无法进入
# 修复步骤：
# 1. 停止所有Obsidian进程
# 2. 删除Vault配置（让Obsidian重新初始化）
# 3. 清理缓存和IndexedDB
# ============================================

Write-Host "`n🔧 Obsidian 修复脚本" -ForegroundColor Cyan
Write-Host "============================================`n"

# 步骤1：停止Obsidian进程
Write-Host "📌 步骤1：停止Obsidian进程..." -ForegroundColor Yellow
Get-Process -Name "Obsidian*" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "✅ Obsidian进程已停止`n" -ForegroundColor Green

# 步骤2：删除Vault配置（让Obsidian重新初始化）
Write-Host "📌 步骤2：删除Vault配置..." -ForegroundColor Yellow
$vaultConfigPath = "C:\Users\wangc\Downloads\ClarkWangVision\.obsidian"
if (Test-Path $vaultConfigPath) {
    $backupPath = "$vaultConfigPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -Path $vaultConfigPath -Destination $backupPath -Recurse -Force
    Write-Host "   已备份配置到: $backupPath" -ForegroundColor Cyan
    Remove-Item -Path $vaultConfigPath -Recurse -Force
    Write-Host "✅ Vault配置已删除`n" -ForegroundColor Green
} else {
    Write-Host "⚠️  Vault配置不存在`n" -ForegroundColor Yellow
}

# 步骤3：清理全局缓存和IndexedDB
Write-Host "📌 步骤3：清理全局缓存..." -ForegroundColor Yellow

$cacheDirs = @(
    "$env:APPDATA\obsidian\Cache",
    "$env:APPDATA\obsidian\Code Cache",
    "$env:APPDATA\obsidian\GPUCache",
    "$env:APPDATA\obsidian\IndexedDB",
    "$env:APPDATA\obsidian\Session Storage",
    "$env:APPDATA\obsidian\Local Storage"
)

foreach ($dir in $cacheDirs) {
    if (Test-Path $dir) {
        Remove-Item -Path $dir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "   ✅ 已删除: $dir" -ForegroundColor Green
    }
}

Write-Host ""

# 步骤4：启动Obsidian
Write-Host "📌 步骤4：启动Obsidian..." -ForegroundColor Yellow
Start-Process "C:\Program Files\Obsidian\Obsidian.exe"
Write-Host "✅ Obsidian已启动`n" -ForegroundColor Green

# 完成提示
Write-Host "============================================`n" -ForegroundColor Cyan
Write-Host "🎉 修复完成！" -ForegroundColor Green
Write-Host "`n💡 接下来：" -ForegroundColor Cyan
Write-Host "   1. Obsidian启动后会显示欢迎界面" -ForegroundColor White
Write-Host "   2. 选择 'Open folder as vault'" -ForegroundColor White
Write-Host "   3. 选择目录: C:\Users\wangc\Downloads\ClarkWangVision" -ForegroundColor White
Write-Host "   4. Obsidian会重新创建Vault配置" -ForegroundColor White
Write-Host "`n如果仍然有问题，请告诉我！" -ForegroundColor Yellow