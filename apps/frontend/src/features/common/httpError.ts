const HTTP_UNAUTHORIZED_PREFIX = "HTTP 401";

export function isUnauthorizedErrorMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes(HTTP_UNAUTHORIZED_PREFIX);
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
