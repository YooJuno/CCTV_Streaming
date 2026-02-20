package com.yoojuno.cctv.stream;

import com.yoojuno.cctv.model.StreamInfo;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class StreamCatalogService {
    @Value("${streams.catalog:mystream:Main Entrance}")
    private String streamCatalogRaw;

    private final Map<String, StreamInfo> catalog = new LinkedHashMap<>();

    @PostConstruct
    public void load() {
        catalog.clear();
        if (streamCatalogRaw == null || streamCatalogRaw.isBlank()) {
            catalog.put("mystream", new StreamInfo("mystream", "Main Entrance"));
            return;
        }
        String[] entries = streamCatalogRaw.split(";");
        for (String entry : entries) {
            if (entry == null || entry.isBlank()) {
                continue;
            }
            String[] pair = entry.split(":", 2);
            String id = pair[0].trim();
            if (id.isBlank()) {
                continue;
            }
            String name = pair.length > 1 ? pair[1].trim() : id;
            if (name.isBlank()) {
                name = id;
            }
            catalog.put(id, new StreamInfo(id, name));
        }
        if (catalog.isEmpty()) {
            catalog.put("mystream", new StreamInfo("mystream", "Main Entrance"));
        }
    }

    public List<StreamInfo> all() {
        return List.copyOf(catalog.values());
    }

    public List<StreamInfo> forAllowedStreamIds(Set<String> allowedStreamIds) {
        if (allowedStreamIds == null || allowedStreamIds.isEmpty()) {
            return List.of();
        }
        if (allowedStreamIds.contains("*")) {
            return all();
        }
        List<StreamInfo> result = new ArrayList<>();
        for (String streamId : allowedStreamIds) {
            StreamInfo info = catalog.get(streamId);
            if (info != null) {
                result.add(info);
            }
        }
        return result;
    }
}
