package com.yoojuno.cctv.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;

@Configuration
public class HlsResourceConfig implements WebMvcConfigurer {
    @Value("${hls.path:./hls}")
    private String hlsPath;

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String location = Path.of(hlsPath).toAbsolutePath().normalize().toUri().toString();
        registry.addResourceHandler("/hls/**")
                .addResourceLocations(location)
                .setCacheControl(CacheControl.noCache());
    }
}
