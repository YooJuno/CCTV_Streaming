package com.yoojuno.cctv.api.auth;

import com.yoojuno.cctv.api.auth.dto.AuthResponse;
import com.yoojuno.cctv.domain.auth.AuthFacadeService;
import org.springframework.stereotype.Component;

@Component
public class AuthApiMapper {
    public AuthResponse toAuthResponse(AuthFacadeService.AuthSession session) {
        return new AuthResponse(
                session.expiresInSeconds(),
                session.username(),
                session.displayName(),
                session.streams()
        );
    }
}
