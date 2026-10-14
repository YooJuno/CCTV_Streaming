package com.yoojuno.cctv.auth;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;

@ExtendWith(OutputCaptureExtension.class)
class UserAccountServiceTest {
    @Test
    void malformedEntriesDoNotPutCredentialsInLogs(CapturedOutput output) {
        UserAccountService service = new UserAccountService(new BCryptPasswordEncoder());
        ReflectionTestUtils.setField(service, "usersRaw", "broken:credential-sentinel;empty:second-sentinel:;valid:{plain}valid-password:mystream");
        service.load();
        assertThat(output).contains("entry #1", "entry #2")
                .doesNotContain("credential-sentinel", "second-sentinel", "valid-password");
        assertThat(service.authenticate("valid", "valid-password")).isPresent();
    }
}
