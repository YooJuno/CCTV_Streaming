import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchStreamSettings, updateStreamSettings } from "../api/client";
import type { StreamSettings } from "../types";

interface StreamSettingsPanelProps {
  streamId: string;
}
const RESOLUTIONS = [
  { value: "QVGA", label: "320 × 240 · 데이터 절약" },
  { value: "CIF", label: "400 × 296 · 균형" },
  { value: "VGA", label: "640 × 480 · 선명하게" },
  { value: "SVGA", label: "800 × 600 · 높은 해상도" },
] as const;
const FPS_OPTIONS = [4, 6, 8, 10, 12];
function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "설정을 처리하지 못했습니다. 잠시 후 다시 시도하세요.";
}

export default function StreamSettingsPanel({
  streamId,
}: StreamSettingsPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["device-settings", streamId],
    queryFn: () => fetchStreamSettings(streamId),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<StreamSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (settings: StreamSettings) =>
      updateStreamSettings(streamId, {
        fps: settings.fps,
        frameSize: settings.frameSize,
        jpegQuality: settings.jpegQuality,
        adaptive: settings.adaptive,
      }),
    onSuccess: (settings) => {
      queryClient.setQueryData(["device-settings", streamId], settings);
      setDraft(settings);
      setSaved(true);
    },
  });
  useEffect(() => {
    if (query.data) setDraft(query.data);
  }, [query.data]);
  const change = <K extends keyof StreamSettings>(
    field: K,
    value: StreamSettings[K],
  ) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setSaved(false);
    mutation.reset();
  };
  const dirty = Boolean(
    draft &&
      query.data &&
      ["fps", "frameSize", "jpegQuality", "adaptive"].some(
        (key) =>
          draft[key as keyof StreamSettings] !==
          query.data[key as keyof StreamSettings],
      ),
  );
  if (query.isPending || (!draft && !query.isError))
    return (
      <div className="stream-settings-loading" role="status">
        <span className="button-spinner" aria-hidden="true" />
        송출 설정을 불러오고 있습니다…
      </div>
    );
  if (query.isError || !draft)
    return (
      <div className="stream-settings-error">
        <p role="alert">{errorMessage(query.error)}</p>
        <button
          type="button"
          className="btn secondary compact"
          onClick={() => void query.refetch()}
        >
          다시 불러오기
        </button>
      </div>
    );

  return (
    <form
      className="stream-settings-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !mutation.isPending) mutation.mutate(draft);
      }}
      aria-label="카메라 송출 설정"
      aria-busy={mutation.isPending}
    >
      <div className="settings-fields">
        <div className="form-field">
          <label htmlFor={`fps-${streamId}`}>송출 FPS</label>
          <select
            id={`fps-${streamId}`}
            value={draft.fps}
            onChange={(event) => change("fps", Number(event.target.value))}
            disabled={mutation.isPending}
          >
            {!FPS_OPTIONS.includes(draft.fps) ? (
              <option value={draft.fps}>{draft.fps} FPS</option>
            ) : null}
            {FPS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value} FPS{value === 6 ? " · 권장" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`resolution-${streamId}`}>영상 해상도</label>
          <select
            id={`resolution-${streamId}`}
            value={draft.frameSize}
            onChange={(event) =>
              change(
                "frameSize",
                event.target.value as StreamSettings["frameSize"],
              )
            }
            disabled={mutation.isPending}
          >
            {RESOLUTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-field settings-quality">
        <div className="settings-quality-heading">
          <label htmlFor={`quality-${streamId}`}>영상 화질</label>
          <span>
            {draft.jpegQuality <= 15
              ? "높음"
              : draft.jpegQuality <= 25
                ? "균형"
                : "용량 절약"}{" "}
            · {draft.jpegQuality}
          </span>
        </div>
        <input
          id={`quality-${streamId}`}
          type="range"
          min="10"
          max="40"
          step="1"
          value={draft.jpegQuality}
          aria-valuetext={`${draft.jpegQuality}, 숫자가 작을수록 높은 화질`}
          onChange={(event) =>
            change("jpegQuality", Number(event.target.value))
          }
          disabled={mutation.isPending}
        />
        <div className="quality-scale" aria-hidden="true">
          <span>높은 화질 · 10</span>
          <span>용량 절약 · 40</span>
        </div>
      </div>
      <label className="settings-adaptive">
        <input
          type="checkbox"
          checked={draft.adaptive}
          onChange={(event) => change("adaptive", event.target.checked)}
          disabled={mutation.isPending}
        />
        <span>
          <strong>네트워크 상태에 맞춰 자동 조절</strong>
          <span>연결이 느려지면 FPS와 화질을 조절해 송출을 유지합니다.</span>
        </span>
      </label>
      <p className="settings-note">
        FPS는 목표값이며 실제 송출 속도는 장비와 네트워크 상태에 따라 낮아질 수
        있습니다. 높은 해상도와 화질은 더 많은 데이터를 사용합니다. 장치가
        서버에 연결되어 있으면 약 10초 내 설정이 적용되며 영상이 잠시 재연결될
        수 있습니다.
      </p>
      {mutation.isError ? (
        <p className="error-text" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {saved ? (
        <p className="settings-success" role="status">
          설정을 저장했습니다. 장치가 서버에 연결되어 있으면 약 10초 내 적용되며
          영상이 잠시 재연결될 수 있습니다.
        </p>
      ) : null}
      <div className="settings-actions">
        <span>카메라에 원격 적용</span>
        <button
          type="submit"
          className="btn compact"
          disabled={!dirty || mutation.isPending}
        >
          {mutation.isPending ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              저장 중…
            </>
          ) : (
            "설정 저장"
          )}
        </button>
      </div>
    </form>
  );
}
