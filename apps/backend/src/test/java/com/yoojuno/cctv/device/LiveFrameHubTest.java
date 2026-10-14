package com.yoojuno.cctv.device;

import org.junit.jupiter.api.Test;
import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import static org.assertj.core.api.Assertions.assertThat;

class LiveFrameHubTest {
    @Test void slowViewersReceiveLatestAndOldPublishersCannotOverwriteNewCamera() throws Exception {
        LiveFrameHub hub = new LiveFrameHub();
        var old = hub.open("camera");
        old.publish(new byte[]{1});
        old.publish(new byte[]{2});
        var frame = hub.await("camera", -1, 5);
        assertThat(frame.jpeg()).containsExactly((byte) 2);
        assertThat(frame.sequence()).isEqualTo(2);
        assertThat(hub.await("camera", frame.sequence(), 5)).isNull();
        var replacement = hub.open("camera");
        old.publish(new byte[]{3});
        old.close();
        replacement.publish(new byte[]{4});
        assertThat(hub.await("camera", frame.sequence(), 5).jpeg()).containsExactly((byte) 4);
        replacement.close();
        assertThat(hub.status("camera").connected()).isFalse();
        assertThat(hub.await("camera", -1, 5)).isNull();
    }

    @Test void framesArePublishedAtTheirBoundaryAndPaddingIsNotIncluded() throws Exception {
        LiveFrameHub hub = new LiveFrameHub();
        var producer = hub.open("camera");
        var bytes = new ByteArrayOutputStream();
        var framer = new JpegStreamFramer(1024, 64, bytes, () -> { producer.publish(bytes.toByteArray()); bytes.reset(); });
        byte[] jpeg = {(byte)255,(byte)216,(byte)255,(byte)254,0,4,(byte)255,(byte)217,(byte)255,(byte)217};
        framer.accept(Arrays.copyOf(jpeg, jpeg.length - 1), jpeg.length - 1);
        assertThat(hub.status("camera").connected()).isFalse();
        framer.accept(new byte[]{(byte)217,0,0},3);
        assertThat(hub.await("camera",-1,5).jpeg()).isEqualTo(jpeg);
        assertThat(framer.finish()).isEqualTo(1);
    }

    @Test void dimensionsAreCheckedWithoutDecodingAndViewerSlotsAreBounded() {
        byte[] jpeg = {(byte)255,(byte)216,(byte)255,(byte)192,0,8,8,0,(byte)240,1,64,1,(byte)255,(byte)217};
        assertThat(LiveFrameHub.viewableJpeg(jpeg)).isTrue();
        jpeg[7]=(byte)255; jpeg[8]=(byte)255;
        assertThat(LiveFrameHub.viewableJpeg(jpeg)).isFalse();
        assertThat(LiveFrameHub.viewableJpeg(new byte[]{(byte)255,(byte)216,(byte)255,(byte)217})).isFalse();
        LiveFrameHub hub = new LiveFrameHub();
        for (int i=0;i<24;i++) assertThat(hub.acquireViewer()).isTrue();
        assertThat(hub.acquireViewer()).isFalse();
        hub.releaseViewer();
        assertThat(hub.acquireViewer()).isTrue();
    }
}
