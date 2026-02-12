param(
    [string]$RtspUrl = "rtsp://localhost:8554/mystream",
    [string]$StreamId = "mystream",
    [string]$HlsDir = (Join-Path $PSScriptRoot "..\apps\back-end\hls"),
    [int]$HlsTime = 2,
    [int]$HlsListSize = 10,
    [bool]$HlsDelete = $true,
    [ValidateSet("tcp", "udp")]
    [string]$RtspTransport = "tcp",
    [switch]$Transcode,
    [string]$VideoCodec = "libx264",
    [string]$AudioCodec = "aac",
    [string]$VideoPreset = "veryfast",
    [string]$VideoTune = "zerolatency"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Error "ffmpeg command not found in PATH"
}

$resolvedHlsDir = [System.IO.Path]::GetFullPath($HlsDir)
New-Item -ItemType Directory -Path $resolvedHlsDir -Force | Out-Null

$hlsFlags = "program_date_time+append_list"
if ($HlsDelete) {
    $hlsFlags = "delete_segments+$hlsFlags"
}

$manifestPath = Join-Path $resolvedHlsDir "$StreamId.m3u8"
$segmentPattern = Join-Path $resolvedHlsDir "${StreamId}_%05d.ts"

Write-Host "RTSP_URL=$RtspUrl"
Write-Host "STREAM_ID=$StreamId"
Write-Host "HLS_DIR=$resolvedHlsDir"
Write-Host "HLS_TIME=$HlsTime"
Write-Host "HLS_LIST_SIZE=$HlsListSize"
Write-Host "HLS_DELETE=$HlsDelete"
Write-Host "RTSP_TRANSPORT=$RtspTransport"
Write-Host "TRANSCODE=$($Transcode.IsPresent)"

if ($Transcode.IsPresent) {
    $ffmpegArgs = @(
        "-rtsp_transport", $RtspTransport,
        "-i", $RtspUrl,
        "-c:v", $VideoCodec,
        "-preset", $VideoPreset,
        "-tune", $VideoTune,
        "-c:a", $AudioCodec,
        "-b:a", "128k",
        "-f", "hls",
        "-hls_time", "$HlsTime",
        "-hls_list_size", "$HlsListSize",
        "-hls_flags", $hlsFlags,
        "-hls_segment_filename", $segmentPattern,
        $manifestPath
    )
} else {
    $ffmpegArgs = @(
        "-rtsp_transport", $RtspTransport,
        "-i", $RtspUrl,
        "-c", "copy",
        "-f", "hls",
        "-hls_time", "$HlsTime",
        "-hls_list_size", "$HlsListSize",
        "-hls_flags", $hlsFlags,
        "-hls_segment_filename", $segmentPattern,
        $manifestPath
    )
}

& ffmpeg @ffmpegArgs
exit $LASTEXITCODE
