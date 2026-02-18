package com.yoojuno.cctv.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;

@Configuration
public class HlsResourceConfig implements WebMvcConfigurer {
    @Value("${hls.path:./hls}")
    private String hlsPath;
    @Value("${hls.allowed-origins:*}")
    private String[] hlsAllowedOrigins;
    @Value("${hls.allowed-methods:GET,HEAD,OPTIONS}")
    private String[] hlsAllowedMethods;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String location = Path.of(hlsPath).toAbsolutePath().normalize().toUri().toString();
        registry.addResourceHandler("/hls/**")
                .addResourceLocations(location)
                .setCacheControl(CacheControl.noCache());
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/hls/**")
                .allowedOrigins(hlsAllowedOrigins)
                .allowedMethods(hlsAllowedMethods)
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
