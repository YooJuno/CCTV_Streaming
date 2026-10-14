package com.yoojuno.cctv.device;

public record DeviceSettings(int fps, FrameSize frameSize, int jpegQuality, boolean adaptive, long revision) {
    public enum FrameSize {
        QVGA, CIF, VGA, SVGA
    }

    public static DeviceSettings defaults() {
        return new DeviceSettings(6, FrameSize.VGA, 20, true, 0);
    }
}
