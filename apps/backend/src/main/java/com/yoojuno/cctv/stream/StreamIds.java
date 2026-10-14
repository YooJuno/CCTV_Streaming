package com.yoojuno.cctv.stream;

import java.util.regex.Pattern;

/** Stream ids must also be valid manifest and segment filename prefixes. */
public final class StreamIds {
    private static final Pattern VALID_ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");

    private StreamIds() {
    }

    public static void requireValid(String streamId) {
        if (streamId == null || !VALID_ID.matcher(streamId).matches()) {
            throw new IllegalStateException("Invalid stream id. Use 1 to 64 letters, digits, '.', '_' or '-', starting with a letter or digit.");
        }
    }
}
