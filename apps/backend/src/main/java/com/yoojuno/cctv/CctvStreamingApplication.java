package com.yoojuno.cctv;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class CctvStreamingApplication {
    public static void main(String[] args) {
        SpringApplication.run(CctvStreamingApplication.class, args);
    }
}
