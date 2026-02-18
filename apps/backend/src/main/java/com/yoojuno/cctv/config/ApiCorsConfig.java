package com.yoojuno.cctv.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ApiCorsConfig implements WebMvcConfigurer {
    @Value("${api.allowed-origins:http://localhost:*,http://127.0.0.1:*,http://192.168.*.*:*,http://10.*.*.*:*,http://172.*.*.*:*}")
    private String[] apiAllowedOrigins;
    @Value("${api.allowed-methods:GET,POST,OPTIONS}")
    private String[] apiAllowedMethods;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns(apiAllowedOrigins)
                .allowedMethods(apiAllowedMethods)
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
