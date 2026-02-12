#!/usr/bin/env python3
"""
Simple media relay using aiortc that registers with Spring signaling and answers WebRTC watchers.
It reads from RTSP/MJPEG sources and can also use a local file when no embedded device is available.

Requirements:
  pip install -r requirements.txt
  brew install ffmpeg

Run:
  python3 webrtc_relay.py
"""

import asyncio
import json
import os
import logging
from aiortc import RTCPeerConnection, RTCSessionDescription, RTCIceServer, RTCConfiguration
from aiortc.rtcrtpsender import RTCRtpSender
from aiortc.sdp import candidate_from_sdp
try:
    # MediaPlayer may be located in aiortc.contrib.media depending on version
    from aiortc.contrib.media import MediaPlayer, MediaRelay
except Exception:
    # older/newer aiortc versions might expose MediaPlayer differently
    try:
        from aiortc import MediaPlayer, MediaRelay  # fallback
    except Exception:
        MediaPlayer = None
        MediaRelay = None
import websockets

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=LOG_LEVEL)
logger = logging.getLogger("relay")

SIGNAL_URL = os.environ.get("SIGNAL_URL", "ws://localhost:8080/signal")
RTSP_URL = os.environ.get("RTSP_URL", "rtsp://localhost:8554/mystream")
MJPEG_URL = os.environ.get("MJPEG_URL", "")
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
ICE_SERVERS_ENV = os.environ.get("ICE_SERVERS", "")
RTSP_OPTIONS_ENV = os.environ.get("RTSP_OPTIONS", "")
MJPEG_OPTIONS_ENV = os.environ.get("MJPEG_OPTIONS", "")
STREAM_ID = "mystream"
LOOP_FILE = os.environ.get("LOOP_FILE", "true").lower() in ("1", "true", "yes", "y")
SOURCE_MODE = os.environ.get("SOURCE_MODE", "auto").lower()  # auto | rtsp | mjpeg | file
STATS_INTERVAL = float(os.environ.get("STATS_INTERVAL", "0"))
STREAMS_JSON = os.environ.get("STREAMS_JSON", "")


def resolve_path_from_root(path_value):
    if not path_value:
        return path_value
    if os.path.isabs(path_value):
        return path_value
    return os.path.join(ROOT_DIR, path_value)


LOCAL_FILE = resolve_path_from_root(os.environ.get("LOCAL_FILE", os.path.join(ROOT_DIR, "docs", "video.mp4")))

pcs = {}
# track periodic stats logging tasks per client session
stats_tasks = {}
relay = MediaRelay() if MediaRelay else None
stream_sources = {}
stream_locks = {}


def load_stream_configs():
    if not STREAMS_JSON:
        return {
            STREAM_ID: {
                "id": STREAM_ID,
                "mode": SOURCE_MODE,
                "rtsp": RTSP_URL,
                "mjpeg": MJPEG_URL,
                "file": LOCAL_FILE,
                "loop": LOOP_FILE,
            }
        }
    try:
        raw = json.loads(STREAMS_JSON)
        configs = {}
        for item in raw:
            if not isinstance(item, dict):
                continue
            stream_id = item.get("id")
            if not stream_id:
                continue
            configs[stream_id] = {
                "id": stream_id,
                "mode": (item.get("mode") or SOURCE_MODE).lower(),
                "rtsp": item.get("rtsp") or RTSP_URL,
                "mjpeg": item.get("mjpeg") or MJPEG_URL,
                "file": resolve_path_from_root(item.get("file") or LOCAL_FILE),
                "loop": bool(item.get("loop", LOOP_FILE)),
            }
        return configs
    except Exception as e:
        logger.warning("Failed to parse STREAMS_JSON: %s", e)
        return {
            STREAM_ID: {
                "id": STREAM_ID,
                "mode": SOURCE_MODE,
                "rtsp": RTSP_URL,
                "mjpeg": MJPEG_URL,
                "file": LOCAL_FILE,
                "loop": LOOP_FILE,
            }
        }


STREAM_CONFIGS = load_stream_configs()


def prefer_codecs(transceiver, kind, preferred_mime_types):
    try:
        caps = RTCRtpSender.getCapabilities(kind)
        preferred = []
        preferred_set = {m.lower() for m in preferred_mime_types}
        for codec in caps.codecs:
            if codec.mimeType.lower() in preferred_set:
                preferred.append(codec)
        if preferred:
            transceiver.setCodecPreferences(preferred)
    except Exception as e:
        logger.debug("Failed to set codec preferences: %s", e)


def load_ice_servers():
    if not ICE_SERVERS_ENV:
        return []
    try:
        raw = json.loads(ICE_SERVERS_ENV)
        if not isinstance(raw, list):
            raw = [raw]
        servers = []
        for item in raw:
            if isinstance(item, str):
                servers.append(RTCIceServer(urls=item))
            elif isinstance(item, dict):
                servers.append(RTCIceServer(**item))
        return servers
    except Exception as e:
        logger.warning("Failed to parse ICE_SERVERS: %s", e)
        return []


def load_rtsp_options():
    if not RTSP_OPTIONS_ENV:
        return {
            "rtsp_transport": "tcp",
            "fflags": "nobuffer",
            "flags": "low_delay",
            "probesize": "32",
            "analyzeduration": "0",
        }
    try:
        return json.loads(RTSP_OPTIONS_ENV)
    except Exception as e:
        logger.warning("Failed to parse RTSP_OPTIONS: %s", e)
        return {}


ICE_SERVERS = load_ice_servers()
RTSP_OPTIONS = load_rtsp_options()


def load_mjpeg_options():
    if not MJPEG_OPTIONS_ENV:
        return {}
    try:
        return json.loads(MJPEG_OPTIONS_ENV)
    except Exception as e:
        logger.warning("Failed to parse MJPEG_OPTIONS: %s", e)
        return {}


MJPEG_OPTIONS = load_mjpeg_options()


def build_file_player(file_path, loop_file):
    options = {"stream_loop": "-1"} if loop_file else {}
    try:
        return MediaPlayer(file_path, loop=loop_file, options=options or None)
    except TypeError:
        return MediaPlayer(file_path, options=options or None)


def build_mjpeg_player(url):
    options = MJPEG_OPTIONS or None
    try:
        return MediaPlayer(url, options=options)
    except TypeError:
        return MediaPlayer(url)


def source_ended(source):
    if not source:
        return True
    video = getattr(source, "video", None)
    audio = getattr(source, "audio", None)
    if video and getattr(video, "readyState", None) == "ended":
        return True
    if audio and getattr(audio, "readyState", None) == "ended":
        return True
    return False


async def get_media_source(stream_id):
    if MediaPlayer is None:
        logger.error("MediaPlayer is not available in aiortc installation")
        return None

    # multi-stream: each stream keeps its own source and lock
    if stream_id not in STREAM_CONFIGS:
        logger.warning("Unknown stream_id=%s", stream_id)
        return None

    if stream_id not in stream_locks:
        stream_locks[stream_id] = asyncio.Lock()

    async with stream_locks[stream_id]:
        if stream_id in stream_sources:
            existing = stream_sources[stream_id]
            if not source_ended(existing):
                return existing
            try:
                existing.stop()
            except Exception:
                pass
            stream_sources.pop(stream_id, None)

        cfg = STREAM_CONFIGS[stream_id]
        source_mode = cfg.get("mode", SOURCE_MODE)
        rtsp_url = cfg.get("rtsp", RTSP_URL)
        mjpeg_url = cfg.get("mjpeg", MJPEG_URL)
        file_path = cfg.get("file", LOCAL_FILE)
        loop_file = bool(cfg.get("loop", LOOP_FILE))

        source = None

        if source_mode in ("auto", "rtsp"):
            try:
                logger.info("Trying RTSP source %s for %s", rtsp_url, stream_id)
                source = MediaPlayer(rtsp_url, format="rtsp", options=RTSP_OPTIONS)
                if getattr(source, "video", None) or getattr(source, "audio", None):
                    stream_sources[stream_id] = source
                    return source
            except Exception as e:
                logger.warning("RTSP open failed: %s", e)

        if source_mode in ("auto", "mjpeg"):
            if not mjpeg_url:
                logger.warning("MJPEG source requested but MJPEG_URL is empty for %s", stream_id)
            else:
                try:
                    logger.info("Trying MJPEG source %s for %s", mjpeg_url, stream_id)
                    source = build_mjpeg_player(mjpeg_url)
                    if getattr(source, "video", None) or getattr(source, "audio", None):
                        stream_sources[stream_id] = source
                        return source
                except Exception as e:
                    logger.warning("MJPEG open failed: %s", e)

        if source_mode in ("auto", "file"):
            if os.path.exists(file_path):
                logger.info("Using local file %s for %s", file_path, stream_id)
                try:
                    source = build_file_player(file_path, loop_file)
                except Exception as e:
                    logger.error("Failed to open local file %s: %s", file_path, e)
            else:
                logger.error("Local file not found: %s", file_path)

        if source:
            stream_sources[stream_id] = source
        return source


def build_pc():
    if ICE_SERVERS:
        return RTCPeerConnection(RTCConfiguration(iceServers=ICE_SERVERS))
    return RTCPeerConnection()


async def cleanup_client(client_session_id):
    task = stats_tasks.pop(client_session_id, None)
    if task:
        task.cancel()
    pc = pcs.pop(client_session_id, None)
    if pc:
        await pc.close()


async def shutdown():
    for task in list(stats_tasks.values()):
        task.cancel()
    if stats_tasks:
        await asyncio.gather(*stats_tasks.values(), return_exceptions=True)
    stats_tasks.clear()

    for pc in list(pcs.values()):
        await pc.close()
    pcs.clear()


async def run():
    if SOURCE_MODE not in ("auto", "rtsp", "mjpeg", "file"):
        logger.warning("Unknown SOURCE_MODE=%s (expected auto|rtsp|mjpeg|file)", SOURCE_MODE)

    try:
        async with websockets.connect(SIGNAL_URL) as ws:
            logger.info("Connected to signaling %s", SIGNAL_URL)

            # signaling protocol expects role="gateway"
            await ws.send(json.dumps({"type": "register", "role": "gateway", "streams": list(STREAM_CONFIGS.keys())}))

            gateway_session_id = None

            async for msg in ws:
                data = json.loads(msg)
                typ = data.get("type")

                if typ == "registered":
                    gateway_session_id = data.get("gatewaySessionId")
                    logger.info("Registered as relay (role=gateway, id=%s)", gateway_session_id)

                elif typ == "watch":
                    client_session_id = data.get("clientSessionId")
                    stream_id = data.get("streamId") or STREAM_ID
                    logger.info("Watch request from client %s for stream %s", client_session_id, stream_id)
                    # create pc and offer
                    pc = build_pc()
                    pcs[client_session_id] = pc

                    # connection / ICE event logging
                    @pc.on("connectionstatechange")
                    async def on_connectionstatechange():
                        logger.info("PC %s connectionState=%s", client_session_id, pc.connectionState)
                        if pc.connectionState in ("failed", "closed", "disconnected"):
                            await cleanup_client(client_session_id)

                    @pc.on("iceconnectionstatechange")
                    async def on_iceconnectionstatechange():
                        logger.info("PC %s iceConnectionState=%s", client_session_id, pc.iceConnectionState)

                    # periodic stats logging to check outbound bytes
                    if STATS_INTERVAL > 0:
                        async def stats_loop():
                            try:
                                while True:
                                    await asyncio.sleep(STATS_INTERVAL)
                                    try:
                                        stats = await pc.getStats()
                                        vbytes = 0
                                        abytes = 0
                                        for s in stats.values():
                                            # aiortc stats objects may have type and kind attributes
                                            if getattr(s, "type", None) == "outbound-rtp":
                                                if getattr(s, "kind", None) == "video":
                                                    vbytes += int(getattr(s, "bytesSent", 0) or 0)
                                                elif getattr(s, "kind", None) == "audio":
                                                    abytes += int(getattr(s, "bytesSent", 0) or 0)
                                        logger.info("STATS client=%s video_bytes=%d audio_bytes=%d", client_session_id, vbytes, abytes)
                                    except Exception as e:
                                        logger.debug("Failed to get stats for %s: %s", client_session_id, e)
                            except asyncio.CancelledError:
                                logger.info("Stats loop cancelled for %s", client_session_id)

                        stats_tasks[client_session_id] = asyncio.create_task(stats_loop())

                    source = await get_media_source(stream_id)

                    if source and source.video:
                        track = relay.subscribe(source.video) if relay else source.video
                        try:
                            t = pc.addTransceiver(kind="video", direction="sendonly")
                            prefer_codecs(t, "video", ["video/VP8"])
                            await t.sender.replaceTrack(track)
                            logger.info("Added video transceiver (sendonly) with track")
                        except Exception:
                            logger.info("Failed to use transceiver; falling back to addTrack")
                            pc.addTrack(track)
                        logger.info("Added video track from source")
                    else:
                        logger.info("No video track available from source")
                    if source and source.audio:
                        track = relay.subscribe(source.audio) if relay else source.audio
                        try:
                            t = pc.addTransceiver(kind="audio", direction="sendonly")
                            prefer_codecs(t, "audio", ["audio/opus"])
                            await t.sender.replaceTrack(track)
                            logger.info("Added audio transceiver (sendonly) with track")
                        except Exception:
                            logger.info("Failed to use transceiver; falling back to addTrack")
                            pc.addTrack(track)
                        logger.info("Added audio track from source")
                    else:
                        logger.info("No audio track available from source")

                    @pc.on("icecandidate")
                    async def on_icecandidate(candidate):
                        logger.debug("Relay ICE candidate event: %s", candidate)
                        if candidate is not None:
                            cand = {
                                "candidate": candidate.candidate,
                                "sdpMid": candidate.sdpMid,
                                "sdpMLineIndex": candidate.sdpMLineIndex,
                            }
                            message = {
                                "type": "ice",
                                "candidate": cand,
                                "clientSessionId": client_session_id,
                                "gatewaySessionId": gateway_session_id,
                            }
                            logger.info("Sending ICE to signaling for client %s", client_session_id)
                            await ws.send(json.dumps(message))

                    # create offer
                    offer = await pc.createOffer()
                    await pc.setLocalDescription(offer)
                    logger.info(
                        "Created offer for client %s (sdp size=%d)",
                        client_session_id,
                        len(pc.localDescription.sdp) if pc.localDescription and pc.localDescription.sdp else 0,
                    )

                    message = {
                        "type": "offer",
                        "sdp": pc.localDescription.sdp,
                        "clientSessionId": client_session_id,
                        "gatewaySessionId": gateway_session_id,
                    }
                    logger.info("Sending offer to signaling for client %s", client_session_id)
                    await ws.send(json.dumps(message))

                elif typ == "answer":
                    client_id = data.get("clientSessionId")
                    sdp = data.get("sdp")
                    if client_id in pcs:
                        pc = pcs[client_id]
                        logger.info("Received answer for client %s (sdp size=%d)", client_id, len(sdp) if sdp else 0)
                        try:
                            await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))
                            logger.info("Set remote description (answer) for client %s", client_id)
                        except Exception as e:
                            logger.warning("Failed to set remote description for %s: %s", client_id, e)

                elif typ == "ice":
                    # message directed to gateway from client
                    # expected fields: clientSessionId, gatewaySessionId, candidate
                    client_id = data.get("clientSessionId")
                    candidate = data.get("candidate")
                    if client_id in pcs and candidate:
                        pc = pcs[client_id]
                        try:
                            cand_sdp = candidate.get("candidate")
                            if not cand_sdp:
                                logger.debug("Empty ICE candidate for client %s", client_id)
                            else:
                                rtc_candidate = candidate_from_sdp(cand_sdp)
                                rtc_candidate.sdpMid = candidate.get("sdpMid")
                                rtc_candidate.sdpMLineIndex = candidate.get("sdpMLineIndex")
                                await pc.addIceCandidate(rtc_candidate)
                                logger.info("Added ICE candidate for client %s", client_id)
                        except Exception as e:
                            logger.warning("Failed to add ICE candidate for %s: %s", client_id, e)

                else:
                    logger.debug("Unhandled message: %s", data)
    finally:
        await shutdown()

if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
