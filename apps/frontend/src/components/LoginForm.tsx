import { type FormEvent, useState } from "react";

interface LoginFormProps {
  loading: boolean;
  errorMessage: string | null;
  onSubmit: (username: string, password: string) => Promise<void>;
}

// Vite replaces VITE_* values in the client bundle. Convenience credentials are dev-only.
const DEFAULT_USERNAME = import.meta.env.DEV
  ? import.meta.env.VITE_DEFAULT_USERNAME || ""
  : "";
const DEFAULT_PASSWORD = import.meta.env.DEV
  ? import.meta.env.VITE_DEFAULT_PASSWORD || ""
  : "";

export default function LoginForm({
  loading,
  errorMessage,
  onSubmit,
}: LoginFormProps) {
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (username.trim()) await onSubmit(username.trim(), password);
  }

  return (
    <main className="auth-layout">
      <section className="auth-story" aria-label="서비스 소개">
        <a
          className="brand auth-brand"
          href="#main-content"
          aria-label="FRAME 관제 시스템"
        >
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle
                cx="12"
                cy="12"
                r="4"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </span>
          <span>
            FRAME<span className="brand-caption">CAMERA OPERATIONS</span>
          </span>
        </a>
        <div className="auth-story-copy">
          <p className="eyebrow">CONNECTED. OBSERVED. IN CONTROL.</p>
          <h1>
            모든 시야를,
            <br />한 곳에서.
          </h1>
          <p>
            실시간 영상부터 장비 상태까지.
            <br />
            중요한 순간을 놓치지 않는 관제의 시작.
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="viewfinder-corner top-left" />
            <div className="viewfinder-corner top-right" />
            <div className="viewfinder-corner bottom-left" />
            <div className="viewfinder-corner bottom-right" />
            <svg viewBox="0 0 240 120" fill="none">
              <path
                d="M73 31h77a8 8 0 0 1 8 8v10l29-12v46l-29-12v10a8 8 0 0 1-8 8H73a8 8 0 0 1-8-8V39a8 8 0 0 1 8-8Z"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle
                cx="111"
                cy="60"
                r="18"
                stroke="currentColor"
                strokeWidth="2"
              />
              <circle
                cx="111"
                cy="60"
                r="7"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
            <span>하나의 화면. 선명한 상황 판단.</span>
          </div>
        </div>
        <p className="auth-story-foot">안전한 공간을 위한, 더 명확한 시야.</p>
      </section>
      <section className="auth-panel" id="main-content">
        <div className="auth-form-wrap">
          <span className="auth-access-label">
            <span className="status-dot" />
            AUTHORIZED ACCESS
          </span>
          <h2>다시 만나 반갑습니다.</h2>
          <p className="auth-subtitle">
            계정으로 로그인하고 관제를 시작하세요.
          </p>
          <form
            onSubmit={handleSubmit}
            className="auth-form"
            aria-busy={loading}
          >
            <div className="form-field">
              <label htmlFor="username">아이디</label>
              <input
                id="username"
                name="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="계정 아이디를 입력하세요"
                disabled={loading}
                required
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="form-field">
              <label htmlFor="password">비밀번호</label>
              <div className="password-field">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="비밀번호를 입력하세요"
                  disabled={loading}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={
                    showPassword ? "비밀번호 숨기기" : "비밀번호 보기"
                  }
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={loading}
                >
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <circle
                      cx="12"
                      cy="12"
                      r="2.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    {showPassword ? (
                      <path
                        d="m4 4 16 16"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    ) : null}
                  </svg>
                </button>
              </div>
            </div>
            {errorMessage ? (
              <p className="error-text" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn login-submit"
              disabled={loading || !username.trim() || !password}
            >
              {loading ? (
                <>
                  <span className="button-spinner" aria-hidden="true" />
                  로그인 중…
                </>
              ) : (
                <>
                  관제 시작하기 <span aria-hidden="true">↗</span>
                </>
              )}
            </button>
          </form>
          <div className="auth-help">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3 4 6v5c0 5 8 10 8 10s8-5 8-10V6l-8-3Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            <p>
              접근 권한이 있는 카메라만 표시됩니다.
              <br />
              계정과 접근 권한은 관리자에게 문의하세요.
            </p>
          </div>
        </div>
        <footer className="auth-footer">FRAME · CCTV 관제 시스템</footer>
      </section>
    </main>
  );
}
