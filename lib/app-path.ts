export const APP_BASE_PATH = "/sales";

export function withBasePath(path: string): string {
  if (/^(?:https?:)?\/\//i.test(path)) return path;
  let normalizedPath = path.startsWith("/") ? path : `/${path}`;
  while (normalizedPath.startsWith(`${APP_BASE_PATH}${APP_BASE_PATH}/`)) {
    normalizedPath = normalizedPath.slice(APP_BASE_PATH.length);
  }
  if (normalizedPath === APP_BASE_PATH || normalizedPath.startsWith(`${APP_BASE_PATH}/`)) {
    return normalizedPath;
  }
  return `${APP_BASE_PATH}${normalizedPath}`;
}
