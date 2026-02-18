/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_HLS_BASE_URL?: string;
  readonly VITE_HLS_URL?: string;
  readonly VITE_DEFAULT_USERNAME?: string;
  readonly VITE_DEFAULT_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
