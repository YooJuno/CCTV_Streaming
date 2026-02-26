package com.yoojuno.cctv.api.common;

public record ErrorResponse(String error) {
    public static ErrorResponse of(String message) {
        return new ErrorResponse(message);
    }
}
