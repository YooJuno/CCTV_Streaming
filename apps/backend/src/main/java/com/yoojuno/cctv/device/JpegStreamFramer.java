package com.yoojuno.cctv.device;

import java.io.IOException;
import java.io.OutputStream;

/** Incremental JPEG framing; segment payloads are opaque and inter-frame camera padding is dropped. */
final class JpegStreamFramer {
    private enum State { SEEK_SOI, MARKER_PREFIX, MARKER_CODE, LENGTH_HIGH, LENGTH_LOW, PAYLOAD, SCAN, SCAN_MARKER }

    private final long maxFrameBytes;
    private final long maxPaddingBytes;
    private final OutputStream output;
    private final Runnable onFrame;
    private final byte[] emitted = new byte[8192];
    private int emittedCount;
    private State state = State.SEEK_SOI;
    private State afterPayload = State.MARKER_PREFIX;
    private boolean soiPrefix;
    private int payloadRemaining;
    private int segmentLength;
    private int previous = -1;
    private long paddingBytes;
    private long frameBytes;
    private long bytesRead;
    private long frames;

    JpegStreamFramer(long maxFrameBytes, long maxPaddingBytes, OutputStream output) {
        this(maxFrameBytes, maxPaddingBytes, output, () -> {});
    }

    JpegStreamFramer(long maxFrameBytes, long maxPaddingBytes, OutputStream output, Runnable onFrame) {
        this.maxFrameBytes = maxFrameBytes;
        this.maxPaddingBytes = maxPaddingBytes;
        this.output = output;
        this.onFrame = onFrame;
    }

    void accept(byte[] buffer, int count) throws IOException {
        for (int index = 0; index < count; index++) {
            int current = buffer[index] & 0xff;
            bytesRead++;
            if (state == State.SEEK_SOI) {
                seekStart(current);
            } else {
                if (++frameBytes > maxFrameBytes) {
                    throw invalid("FRAME_TOO_LARGE", current);
                }
                emit(current);
                switch (state) {
                    case MARKER_PREFIX -> {
                        if (current != 0xff) throw invalid("INVALID_MARKER_PREFIX", current);
                        state = State.MARKER_CODE;
                    }
                    case MARKER_CODE -> marker(current, false);
                    case LENGTH_HIGH -> {
                        segmentLength = current << 8;
                        state = State.LENGTH_LOW;
                    }
                    case LENGTH_LOW -> {
                        segmentLength |= current;
                        if (segmentLength < 2) throw invalid("INVALID_SEGMENT_LENGTH", current);
                        payloadRemaining = segmentLength - 2;
                        state = payloadRemaining == 0 ? afterPayload : State.PAYLOAD;
                    }
                    case PAYLOAD -> {
                        if (--payloadRemaining == 0) state = afterPayload;
                    }
                    case SCAN -> {
                        if (current == 0xff) state = State.SCAN_MARKER;
                    }
                    case SCAN_MARKER -> marker(current, true);
                    default -> throw new IllegalStateException("Unexpected JPEG parser state.");
                }
            }
            previous = current;
        }
    }

    private void seekStart(int current) throws IOException {
        if (soiPrefix && current == 0xd8) {
            soiPrefix = false;
            frameBytes = 2;
            paddingBytes = 0;
            state = State.MARKER_PREFIX;
            emit(0xff);
            emit(0xd8);
            return;
        }
        if (soiPrefix) {
            paddingBytes++;
        }
        soiPrefix = current == 0xff;
        if (!soiPrefix) {
            paddingBytes++;
        }
        if (paddingBytes > maxPaddingBytes) {
            throw invalid("INTER_FRAME_PADDING_TOO_LARGE", current);
        }
    }

    private void marker(int current, boolean inScan) throws IOException {
        if (current == 0xff) {
            return; // Legal marker fill bytes.
        }
        if (inScan && current == 0x00) {
            state = State.SCAN; // Escaped 0xff entropy data.
            return;
        }
        if (current == 0xd9) {
            frames++;
            flush();
            onFrame.run();
            state = State.SEEK_SOI;
            soiPrefix = false;
            paddingBytes = 0;
            return;
        }
        if (current == 0x01 || current >= 0xd0 && current <= 0xd7) {
            state = inScan ? State.SCAN : State.MARKER_PREFIX;
            return;
        }
        if (current == 0xd8 || current < 0xc0) {
            throw invalid("INVALID_MARKER", current);
        }
        // APP/COM/DQT payloads can contain 0xff 0xd9. Only their declared length has meaning here.
        afterPayload = current == 0xda || inScan && current == 0xdc ? State.SCAN : State.MARKER_PREFIX;
        state = State.LENGTH_HIGH;
    }

    long finish() throws IOException {
        if (state != State.SEEK_SOI) {
            throw invalid("INCOMPLETE_FRAME", -1);
        }
        if (soiPrefix && ++paddingBytes > maxPaddingBytes) {
            throw invalid("INTER_FRAME_PADDING_TOO_LARGE", -1);
        }
        if (frames == 0) {
            throw invalid("NO_JPEG_FRAMES", -1);
        }
        flush();
        return frames;
    }

    void flush() throws IOException {
        if (emittedCount > 0) {
            output.write(emitted, 0, emittedCount);
            emittedCount = 0;
            output.flush();
        }
    }

    private void emit(int current) throws IOException {
        emitted[emittedCount++] = (byte) current;
        if (emittedCount == emitted.length) flush();
    }

    private InvalidJpegException invalid(String code, int current) {
        return new InvalidJpegException(code, bytesRead, frameBytes, frames, previous, current);
    }

    static final class InvalidJpegException extends IOException {
        final String code;
        final long bytesRead;
        final long frameBytes;
        final long frames;
        final int previous;
        final int current;

        private InvalidJpegException(String code, long bytesRead, long frameBytes, long frames, int previous, int current) {
            super(code);
            this.code = code;
            this.bytesRead = bytesRead;
            this.frameBytes = frameBytes;
            this.frames = frames;
            this.previous = previous;
            this.current = current;
        }
    }
}
