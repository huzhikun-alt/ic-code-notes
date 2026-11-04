param([int]$Port = 8710)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host ""
Write-Host "  IC 代码笔记 · 本地服务已启动" -ForegroundColor Green
Write-Host "  http://127.0.0.1:$Port/" -ForegroundColor Cyan
Write-Host "  关闭这个窗口即停止服务" -ForegroundColor DarkGray
Write-Host ""

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $stream.ReadTimeout  = 5000
    $stream.WriteTimeout = 5000
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
    $requestLine = $reader.ReadLine()
    while ($true) { $h = $reader.ReadLine(); if ([string]::IsNullOrEmpty($h)) { break } }

    if ([string]::IsNullOrEmpty($requestLine)) { $client.Close(); continue }

    $target = ($requestLine -split ' ')[1]
    if ([string]::IsNullOrEmpty($target) -or $target -eq '/') { $target = '/index.html' }
    $target = $target.Split('?')[0]
    $relative = [System.Uri]::UnescapeDataString($target.TrimStart('/')).Replace('/', '\')
    $full = Join-Path $root $relative

    if ((Test-Path $full -PathType Leaf) -and ($full.StartsWith($root))) {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $mime = switch ($ext) {
        '.html' { 'text/html; charset=utf-8' }
        '.css'  { 'text/css; charset=utf-8' }
        '.js'   { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.svg'  { 'image/svg+xml' }
        '.png'  { 'image/png' }
        default { 'application/octet-stream' }
      }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $mime`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($bytes, 0, $bytes.Length)
    } else {
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($msg.Length)`r`nConnection: close`r`n`r`n"
      $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
      $stream.Write($hb, 0, $hb.Length)
      $stream.Write($msg, 0, $msg.Length)
    }
  } catch {
    # 单个请求出错不影响服务
  } finally {
    if ($client) { $client.Close() }
  }
}
