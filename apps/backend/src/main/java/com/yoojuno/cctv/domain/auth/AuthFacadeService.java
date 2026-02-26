package com.yoojuno.cctv.domain.auth;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.auth.JwtService;
import com.yoojuno.cctv.auth.UserAccountService;
import com.yoojuno.cctv.model.StreamInfo;
import com.yoojuno.cctv.stream.StreamCatalogService;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

@Service
public class AuthFacadeService {
    private final UserAccountService userAccountService;
    private final StreamCatalogService streamCatalogService;
    private final JwtService jwtService;

    public AuthFacadeService(
            UserAccountService userAccountService,
            StreamCatalogService streamCatalogService,
            JwtService jwtService
    ) {
        this.userAccountService = userAccountService;
        this.streamCatalogService = streamCatalogService;
        this.jwtService = jwtService;
    }

    public Optional<LoginResult> login(String username, String password) {
        Optional<AuthenticatedUser> user = userAccountService.authenticate(username, password);
        if (user.isEmpty()) {
            return Optional.empty();
        }
        AuthenticatedUser authenticatedUser = user.get();
        String token = jwtService.issueToken(authenticatedUser);
        AuthSession session = sessionFor(authenticatedUser);
        return Optional.of(new LoginResult(token, session));
    }

    public AuthSession sessionFor(AuthenticatedUser user) {
        List<StreamInfo> streams = streamCatalogService.forAllowedStreamIds(user.allowedStreams());
        return new AuthSession(
                jwtService.expirationSeconds(),
                user.username(),
                user.displayName(),
                streams
        );
    }

    public long expirationSeconds() {
        return jwtService.expirationSeconds();
    }

    public record AuthSession(
            long expiresInSeconds,
            String username,
            String displayName,
            List<StreamInfo> streams
    ) {
    }

    public record LoginResult(
            String token,
            AuthSession session
    ) {
    }
}
