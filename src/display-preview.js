// Presentation preferences only. They never replace recorded device observations.
export function configuredWifiPreviewIds(env = {}) {
  if (typeof env.WIFI_PREVIEW_DEVICE_IDS !== 'string') return [];
  return [...new Set(env.WIFI_PREVIEW_DEVICE_IDS.split(',')
    .map(id => id.trim().toLowerCase())
    .filter(id => /^[a-f0-9]{24}$/.test(id)))];
}
