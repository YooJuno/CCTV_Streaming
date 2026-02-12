import { FormEvent, useState } from "react";

interface LoginFormProps {
  loading: boolean;
  errorMessage: string | null;
  onSubmit: (username: string, password: string) => Promise<void>;
}

const DEFAULT_USERNAME = import.meta.env.VITE_DEFAULT_USERNAME || "admin";
const DEFAULT_PASSWORD = import.meta.env.VITE_DEFAULT_PASSWORD || "admin123";

export default function LoginForm({ loading, errorMessage, onSubmit }: LoginFormProps) {
  const [username, setUsername] = useState(DEFAULT_USERNAME);
  const [password, setPassword] = useState(DEFAULT_PASSWORD);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSubmit(username.trim(), password);
  }

  return (
    <section className="auth-panel">
      <h2>Sign In</h2>
      <p className="auth-subtitle">Use a backend account to load authorized streams.</p>

      <form onSubmit={handleSubmit} className="auth-form">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoComplete="username"
          placeholder="admin"
          disabled={loading}
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          placeholder="••••••••"
          disabled={loading}
          required
        />

        <button type="submit" className="btn" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
    </section>
  );
}
