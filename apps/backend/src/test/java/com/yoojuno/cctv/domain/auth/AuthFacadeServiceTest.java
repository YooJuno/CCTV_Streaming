package com.yoojuno.cctv.domain.auth;

import com.yoojuno.cctv.auth.AuthenticatedUser;
import com.yoojuno.cctv.auth.JwtService;
import com.yoojuno.cctv.auth.UserAccountService;
import com.yoojuno.cctv.stream.StreamCatalogService;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthFacadeServiceTest {
    @Test
    void reportsTokenTimeRemainingInsteadOfTheOriginalLifetime() {
        AuthFacadeService service = service();
        AuthenticatedUser user = new AuthenticatedUser("viewer", "viewer", Set.of("mystream"), Instant.now().plusSeconds(120));
        assertThat(service.sessionFor(user).expiresInSeconds()).isBetween(118L, 120L);
    }

    @Test
    void clampsExpiredSessionsToZero() {
        AuthenticatedUser user = new AuthenticatedUser("viewer", "viewer", Set.of("mystream"), Instant.now().minusSeconds(1));
        assertThat(service().sessionFor(user).expiresInSeconds()).isZero();
    }

    @Test
    void freshlyAuthenticatedAccountsReportTheConfiguredLifetime() {
        AuthenticatedUser user = new AuthenticatedUser("viewer", "viewer", Set.of("mystream"));
        assertThat(service().sessionFor(user).expiresInSeconds()).isEqualTo(3600);
    }

    private static AuthFacadeService service() {
        JwtService jwtService = mock(JwtService.class);
        when(jwtService.expirationSeconds()).thenReturn(3600L);
        StreamCatalogService catalog = mock(StreamCatalogService.class);
        when(catalog.forAllowedStreamIds(Set.of("mystream"))).thenReturn(List.of());
        return new AuthFacadeService(mock(UserAccountService.class), catalog, jwtService);
    }
}
