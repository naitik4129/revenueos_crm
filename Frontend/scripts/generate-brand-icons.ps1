# Render the vector mark into browser / home-screen assets using Windows System.Drawing.
# Run from any directory: powershell -File Frontend/scripts/generate-brand-icons.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$publicPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public'))
[xml]$svg = Get-Content -LiteralPath (Join-Path $publicPath 'brand/motm-mark.svg') -Raw
$shape = New-Object System.Drawing.Drawing2D.GraphicsPath
foreach ($polygon in ($svg.svg.path.d -split '[MmZz]' | Where-Object { $_.Trim() })) {
    $numbers = [regex]::Matches($polygon, '-?\d+(?:\.\d+)?')
    $points = for ($i = 0; $i -lt $numbers.Count; $i += 2) {
        New-Object System.Drawing.PointF([single]$numbers[$i].Value, [single]$numbers[$i + 1].Value)
    }
    $shape.AddPolygon([System.Drawing.PointF[]]$points)
}
$shape.FillMode = [System.Drawing.Drawing2D.FillMode]::Alternate
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF(229, 505)),
    (New-Object System.Drawing.PointF(851, 150)),
    [System.Drawing.ColorTranslator]::FromHtml('#cd402c'),
    [System.Drawing.ColorTranslator]::FromHtml('#f58a59')
)

function Render-Icon([int]$size) {
    $canvas = New-Object System.Drawing.Bitmap(1024, 1024)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#fff9f5'))
    # Same safe area, scale and centering as favicon.svg; no tiny wordmark.
    $scale = [single](1024 * 54 / 64 / 640)
    $matrix = New-Object System.Drawing.Drawing2D.Matrix($scale, 0, 0, $scale, (1024 * 5 / 64 - 220 * $scale), ((1024 - 530 * $scale) / 2))
    $graphics.Transform = $matrix
    $graphics.FillPath($gradient, $shape)
    $result = New-Object System.Drawing.Bitmap($size, $size)
    $resizer = [System.Drawing.Graphics]::FromImage($result)
    $resizer.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $resizer.DrawImage($canvas, 0, 0, $size, $size)
    $stream = New-Object IO.MemoryStream
    $result.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $stream.ToArray()
    $stream.Dispose()
    $resizer.Dispose()
    $result.Dispose()
    $matrix.Dispose()
    $graphics.Dispose()
    $canvas.Dispose()
    return ,$bytes
}

[IO.File]::WriteAllBytes((Join-Path $publicPath 'apple-touch-icon.png'), (Render-Icon 180))
[IO.File]::WriteAllBytes((Join-Path $publicPath 'brand/motm-icon-512.png'), (Render-Icon 512))
$sizes = @(16, 32, 48, 256)
$images = @($sizes | ForEach-Object { ,(Render-Icon $_) })
$output = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter($output)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$dimension)
    $writer.Write([byte]$dimension)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$images[$i].Length)
    $writer.Write([uint32]$offset)
    $offset += $images[$i].Length
}
foreach ($bytes in $images) { $writer.Write([byte[]]$bytes) }
$writer.Flush()
[IO.File]::WriteAllBytes((Join-Path $publicPath 'favicon.ico'), $output.ToArray())
$writer.Dispose()
$output.Dispose()
$gradient.Dispose()
$shape.Dispose()
Write-Output 'Generated 16/32/48/256px favicon.ico, 180px Apple touch icon and 512px brand icon.'
