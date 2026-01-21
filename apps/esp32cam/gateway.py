#!/usr/bin/env python3
"""
Simple media gateway using aiortc that registers with Spring signaling and answers WebRTC watchers
It reads from an RTSP source (rtsp://localhost:8554/mystream) or falls back to local video.mp4 if RTSP is unavailable.

Requirements:
  pip install -r requirements.txt
  brew install ffmpeg

Run:
  python3 gateway.py
"""

import asyncio
import json
import os
import sys
import logging
from aiortc import RTCPeerConnection, RTCSessionDescription, MediaPlayer
import websockets

logging.basicConfig(level=logging.INFO)

SIGNAL_URL = os.environ.get("SIGNAL_URL", "ws://localhost:8080/signal")
RTSP_URL = os.environ.get("RTSP_URL", "rtsp://localhost:8554/mystream")
LOCAL_FILE = os.path.join(os.path.dirname(__file__), "../../video.mp4")

pcs = {}

async def run():
    async with websockets.connect(SIGNAL_URL) as ws:
        logging.info("Connected to signaling %s", SIGNAL_URL)

        # register as gateway
        await ws.send(json.dumps({"type": "register", "role": "gateway", "streams": ["mystream"]}))

        gateway_session_id = None

        async for msg in ws:
            data = json.loads(msg)
            typ = data.get("type")

            if typ == "registered":
                gateway_session_id = data.get("gatewaySessionId")
                logging.info("Registered as gateway (id=%s)", gateway_session_id)

            elif typ == "watch":
                client_session_id = data.get("clientSessionId")
                stream_id = data.get("streamId")
                logging.info("Watch request from client %s for stream %s", client_session_id, stream_id)
                # create pc and offer
                pc = RTCPeerConnection()
                pcs[client_session_id] = pc

                # get media source: try RTSP first, fall back to local file
                source = None
                try:
                    logging.info("Trying RTSP source %s", RTSP_URL)
                    source = MediaPlayer(RTSP_URL, format="rtsp")
                except Exception as e:
                    logging.warning("RTSP open failed: %s, fallback to file", e)

                if source is None or (not source.audio and not source.video and os.path.exists(LOCAL_FILE)):
                    logging.info("Using local file %s", LOCAL_FILE)
                    source = MediaPlayer(LOCAL_FILE)

                if source.video:
                    pc.addTrack(source.video)
                if source.audio:
                    pc.addTrack(source.audio)

                @pc.on("icecandidate")
                async def on_icecandidate(candidate):
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
                        await ws.send(json.dumps(message))

                # create offer
                offer = await pc.createOffer()
                await pc.setLocalDescription(offer)

                message = {
                    "type": "offer",
                    "sdp": pc.localDescription.sdp,
                    "clientSessionId": client_session_id,
                    "gatewaySessionId": gateway_session_id,
                }
                await ws.send(json.dumps(message))

            elif typ == "answer":
                client_id = data.get("clientSessionId")
                sdp = data.get("sdp")
                if client_id in pcs:
                    pc = pcs[client_id]
                    logging.info("Received answer for client %s", client_id)
                    await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type="answer"))

            elif typ == "ice":
                # message directed to gateway from client
                # expected fields: clientSessionId, gatewaySessionId, candidate
                client_id = data.get("clientSessionId")
                candidate = data.get("candidate")
                if client_id in pcs and candidate:
                    pc = pcs[client_id]
                    try:
                        await pc.addIceCandidate(candidate)
                    except Exception as e:
                        logging.warning("Failed to add ICE candidate: %s", e)

            else:
                logging.debug("Unhandled message: %s", data)

if __name__ == "__main__":
    try:
        asyncio.get_event_loop().run_until_complete(run())
    except KeyboardInterrupt:
        pass
    finally:
        for pc in pcs.values():
            asyncio.get_event_loop().run_until_complete(pc.close())
