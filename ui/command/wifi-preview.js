// A server-selected display preview is separate from device observations and review evidence.
export function wifiPreviewEnabled(ctx, device, detail, exercise = false) {
  if (ctx?.role !== 'operator' || ctx.demo || exercise || !device?.id ||
    device.synthetic === true || device.source === 'simulation-studio') return false;
  // Loaded with the operator session before the workspace mounts. Detail latency or
  // a transient detail failure must not change this presentation preference.
  const configuredIds = ctx.displayPreferences?.wifiConnectedDeviceIds;
  if (Array.isArray(configuredIds)) return configuredIds.includes(device.id);
  return detail?.state === 'ok' && detail.id === device.id && detail.data?.device?.id === device.id &&
    detail.data.mode === 'live' && detail.data.displayPreview?.wifiConnected === true &&
    detail.data.displayPreview.source === 'simulation';
}
