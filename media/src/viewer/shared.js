export function formatAge(mtimeMs) {
  const deltaMs = Date.now() - mtimeMs;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (deltaMs < minuteMs) {
    return "just now";
  }
  if (deltaMs < hourMs) {
    return `${Math.floor(deltaMs / minuteMs)}m ago`;
  }
  if (deltaMs < dayMs) {
    return `${Math.floor(deltaMs / hourMs)}h ago`;
  }
  return `${Math.floor(deltaMs / dayMs)}d ago`;
}

export function formatWordCount(value) {
  if (value < 1000) {
    return `${value} words`;
  }
  if (value < 1000 * 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k words`;
  }
  return `${(value / (1000 * 1000)).toFixed(1).replace(/\.0$/, "")}M words`;
}

export function basename(value) {
  const parts = value.split("/");
  return parts[parts.length - 1] || value;
}

export function dirname(value) {
  const parts = value.split("/");
  if (parts.length <= 1) {
    return ".";
  }
  return parts.slice(0, -1).join("/");
}
