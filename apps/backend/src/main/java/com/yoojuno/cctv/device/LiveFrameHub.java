package com.yoojuno.cctv.device;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;

/** A single latest frame per camera; slow viewers skip frames rather than build a queue. */
@Service
public class LiveFrameHub {
    private final Map<String, Channel> channels = new ConcurrentHashMap<>();
    @Value("${devices.max-live-viewers:24}")
    private int maxViewers = 24;
    private Semaphore viewers = new Semaphore(24);

    @PostConstruct
    public void initialize() {
        if (maxViewers < 1) throw new IllegalStateException("Invalid live viewer limit.");
        viewers = new Semaphore(maxViewers);
    }

    public Producer open(String streamId) {
        Channel channel = channels.computeIfAbsent(streamId, ignored -> new Channel());
        synchronized (channel) {
            Producer producer = new Producer(channel);
            channel.producer = producer;
            channel.latest = null;
            channel.samples.clear();
            channel.notifyAll();
            return producer;
        }
    }

    public Frame await(String streamId, long afterSequence, long timeoutMs) throws InterruptedException {
        Channel channel = channels.computeIfAbsent(streamId, ignored -> new Channel());
        long deadline = System.nanoTime() + timeoutMs * 1_000_000;
        synchronized (channel) {
            while (true) {
                if (channel.latest != null && channel.latest.sequence() > afterSequence
                        && System.currentTimeMillis() - channel.latest.receivedAtEpochMs() <= 5000) {
                    return channel.latest;
                }
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) return null;
                channel.wait(Math.max(1, remaining / 1_000_000));
            }
        }
    }

    public Status status(String streamId) {
        Channel channel = channels.get(streamId);
        if (channel == null) return new Status(false, -1, 0, 0, 0);
        synchronized (channel) {
            long now = System.currentTimeMillis();
            trimSamples(channel, now);
            long age = channel.latest == null ? -1 : Math.max(0, now - channel.latest.receivedAtEpochMs());
            double fps = 0;
            double bytesPerSecond = 0;
            if (channel.samples.size() > 1) {
                double seconds = (channel.samples.getLast().at() - channel.samples.getFirst().at()) / 1000.0;
                if (seconds > 0) {
                    fps = (channel.samples.size() - 1) / seconds;
                    long bytes = channel.samples.stream().mapToLong(Sample::bytes).sum() - channel.samples.getFirst().bytes();
                    bytesPerSecond = bytes / seconds;
                }
            }
            return new Status(channel.producer != null && age >= 0 && age <= 5000, age,
                    Math.round(fps * 10) / 10.0, Math.round(bytesPerSecond), channel.sequence);
        }
    }

    public boolean acquireViewer() { return viewers.tryAcquire(); }
    public void releaseViewer() { viewers.release(); }

    /** Read JPEG SOF dimensions without decoding or accepting image bombs into the live relay. */
    static boolean viewableJpeg(byte[] jpeg) {
        if (jpeg.length < 4 || jpeg[0] != (byte) 0xff || jpeg[1] != (byte) 0xd8) return false;
        int offset = 2;
        while (offset < jpeg.length) {
            if ((jpeg[offset++] & 255) != 255) return false;
            while (offset < jpeg.length && (jpeg[offset] & 255) == 255) offset++;
            if (offset >= jpeg.length) return false;
            int marker = jpeg[offset++] & 255;
            if (marker == 0xda || marker == 0xd9) return false;
            if (marker == 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
            if (offset + 1 >= jpeg.length) return false;
            int length = ((jpeg[offset] & 255) << 8) | (jpeg[offset + 1] & 255);
            if (length < 2 || offset + length > jpeg.length) return false;
            if (marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc) {
                if (length < 8) return false;
                int height = ((jpeg[offset + 3] & 255) << 8) | (jpeg[offset + 4] & 255);
                int width = ((jpeg[offset + 5] & 255) << 8) | (jpeg[offset + 6] & 255);
                return width > 0 && height > 0 && (long) width * height <= 2_073_600;
            }
            offset += length;
        }
        return false;
    }

    private static void trimSamples(Channel channel, long now) {
        while (!channel.samples.isEmpty() && (channel.samples.getFirst().at() < now - 5000 || channel.samples.size() > 256)) {
            channel.samples.removeFirst();
        }
    }

    public record Frame(long sequence, long receivedAtEpochMs, byte[] jpeg) {}
    public record Status(boolean connected, long frameAgeMs, double receivedFps, double bytesPerSecond, long sequence) {}
    private record Sample(long at, int bytes) {}
    private static final class Channel {
        Producer producer;
        Frame latest;
        long sequence;
        final ArrayDeque<Sample> samples = new ArrayDeque<>();
    }

    public static final class Producer implements AutoCloseable {
        private final Channel channel;
        private Producer(Channel channel) { this.channel = channel; }

        /** The caller transfers ownership of this immutable JPEG byte array. */
        public void publish(byte[] jpeg) {
            synchronized (channel) {
                if (channel.producer != this) return;
                long now = System.currentTimeMillis();
                channel.latest = new Frame(++channel.sequence, now, jpeg);
                channel.samples.addLast(new Sample(now, jpeg.length));
                trimSamples(channel, now);
                channel.notifyAll();
            }
        }

        @Override
        public void close() {
            synchronized (channel) {
                if (channel.producer != this) return;
                channel.producer = null;
                channel.latest = null;
                channel.samples.clear();
                channel.notifyAll();
            }
        }
    }
}
