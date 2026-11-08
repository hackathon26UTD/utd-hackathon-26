// A server-selected display preview is separate from device observations and review evidence.
export function wifiPreviewEnabled(ctx, device, detail, exercise = false) {
  return ctx?.role === 'operator' && !ctx.demo && !exercise &&
    !!device?.id && device.synthetic !== true && device.source !== 'simulation-studio' &&
    detail?.state === 'ok' && detail.id === device.id && detail.data?.device?.id === device.id &&
    detail.data.mode === 'live' && detail.data.displayPreview?.wifiConnected === true &&
    detail.data.displayPreview.source === 'simulation';
}
