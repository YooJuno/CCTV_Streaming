package com.yoojuno.cctv.device;

import org.junit.jupiter.api.Test;

import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageTypeSpecifier;
import javax.imageio.metadata.IIOMetadataNode;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Arrays;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JpegStreamFramerTest {
    @Test
    void stripsCameraTrailingPaddingAndStaleTailBetweenCompleteFrames() throws Exception {
        byte[] jpeg = jpeg(false);
        byte[] padding = {0, 0, 0, 0, 0x12, (byte) 0xff, (byte) 0xd9, 0x34, (byte) 0xff};
        byte[] input = concat(jpeg, padding, jpeg, new byte[64]);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        JpegStreamFramer parser = new JpegStreamFramer(2 * 1024 * 1024, 65536, output);
        parser.accept(input, input.length);
        assertThat(parser.finish()).isEqualTo(2);
        assertThat(output.toByteArray()).isEqualTo(concat(jpeg, jpeg));
    }

    @Test
    void eoiBytesInsideCommentAndAppPayloadDoNotEndTheFrame() throws Exception {
        byte[] original = jpeg(false);
        for (int marker : new int[]{0xfe, 0xe1}) {
            byte[] payload = {(byte) 0xff, (byte) marker, 0, 6, 0x11, (byte) 0xff, (byte) 0xd9, 0x22};
            byte[] image = concat(Arrays.copyOf(original, 2), payload, Arrays.copyOfRange(original, 2, original.length));
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            JpegStreamFramer parser = new JpegStreamFramer(2 * 1024 * 1024, 65536, output);
            parser.accept(image, image.length);
            assertThat(parser.finish()).isEqualTo(1);
            assertThat(output.toByteArray()).isEqualTo(image);
            assertThat(ImageIO.read(new java.io.ByteArrayInputStream(image))).isNotNull();
        }
    }

    @Test
    void handlesSplitMarkersEntropyEscapesAndRestartMarkersWithoutChangingTheImage() throws Exception {
        byte[] jpeg = jpeg(true);
        assertThat(contains(jpeg, 0xff, 0x00)).isTrue();
        assertThat(contains(jpeg, 0xff, 0xd0)).isTrue();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        JpegStreamFramer parser = new JpegStreamFramer(2 * 1024 * 1024, 65536, output);
        for (byte value : jpeg) {
            parser.accept(new byte[]{value}, 1);
        }
        assertThat(parser.finish()).isEqualTo(1);
        assertThat(output.toByteArray()).isEqualTo(jpeg);
    }

    @Test
    void retainsTheFrameLimitAndRejectsIncompleteImages() throws Exception {
        byte[] jpeg = jpeg(false);
        JpegStreamFramer oversized = new JpegStreamFramer(jpeg.length - 1, 65536, new ByteArrayOutputStream());
        assertThatThrownBy(() -> oversized.accept(jpeg, jpeg.length)).hasMessage("FRAME_TOO_LARGE");
        JpegStreamFramer incomplete = new JpegStreamFramer(2 * 1024 * 1024, 65536, new ByteArrayOutputStream());
        incomplete.accept(jpeg, jpeg.length - 1);
        assertThatThrownBy(incomplete::finish).hasMessage("INCOMPLETE_FRAME");
    }

    @Test
    void rejectsExcessivePaddingAndBodiesWithoutAnyJpeg() throws Exception {
        JpegStreamFramer excessive = new JpegStreamFramer(2 * 1024 * 1024, 64, new ByteArrayOutputStream());
        assertThatThrownBy(() -> excessive.accept(new byte[65], 65)).hasMessage("INTER_FRAME_PADDING_TOO_LARGE");
        JpegStreamFramer missing = new JpegStreamFramer(2 * 1024 * 1024, 64, new ByteArrayOutputStream());
        missing.accept(new byte[64], 64);
        assertThatThrownBy(missing::finish).hasMessage("NO_JPEG_FRAMES");
    }

    private static byte[] jpeg(boolean restarts) throws Exception {
        BufferedImage image = new BufferedImage(160, 120, BufferedImage.TYPE_INT_RGB);
        Random random = new Random(42);
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) image.setRGB(x, y, random.nextInt(0x1000000));
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        var parameters = writer.getDefaultWriteParam();
        var metadata = writer.getDefaultImageMetadata(ImageTypeSpecifier.createFromRenderedImage(image), parameters);
        if (restarts) {
            String format = metadata.getNativeMetadataFormatName();
            var tree = (IIOMetadataNode) metadata.getAsTree(format);
            var sequence = (IIOMetadataNode) tree.getElementsByTagName("markerSequence").item(0);
            IIOMetadataNode dri = new IIOMetadataNode("dri");
            dri.setAttribute("interval", "4");
            sequence.appendChild(dri);
            metadata.setFromTree(format, tree);
        }
        try (var stream = ImageIO.createImageOutputStream(output)) {
            writer.setOutput(stream);
            writer.write(null, new IIOImage(image, null, metadata), parameters);
        } finally {
            writer.dispose();
        }
        return output.toByteArray();
    }

    private static boolean contains(byte[] bytes, int first, int second) {
        for (int index = 1; index < bytes.length; index++) {
            if ((bytes[index - 1] & 0xff) == first && (bytes[index] & 0xff) == second) return true;
        }
        return false;
    }

    private static byte[] concat(byte[]... parts) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        for (byte[] part : parts) output.write(part);
        return output.toByteArray();
    }
}
