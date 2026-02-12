param(
    [string]$VideoFile = (Join-Path $PSScriptRoot "..\docs\video.mp4"),
    [string]$RtspUrl = "rtsp://localhost:8554/mystream",
    [ValidateSet("tcp", "udp")]
    [string]$RtspTransport = "tcp",
    [switch]$Transcode
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "ffmpeg command not found in PATH"
}

$resolvedVideo = [System.IO.Path]::GetFullPath($VideoFile)
if (-not (Test-Path $resolvedVideo)) {
    Write-Error "Video file not found: $resolvedVideo"
}

$codecArgs = if ($Transcode.IsPresent) {
    @(
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k"
    )
} else {
    @("-c", "copy")
}

$ffmpegArgs = @(
    "-re",
    "-stream_loop", "-1",
    "-i", $resolvedVideo,
    "-rtsp_transport", $RtspTransport
) + $codecArgs + @(
    "-f", "rtsp",
    $RtspUrl
)

Write-Host "Publishing $resolvedVideo -> $RtspUrl"
Write-Host "RTSP_TRANSPORT=$RtspTransport"
Write-Host "TRANSCODE=$($Transcode.IsPresent)"

& ffmpeg @ffmpegArgs
exit $LASTEXITCODE
