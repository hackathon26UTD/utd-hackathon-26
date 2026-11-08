// Explicit public design preview only. Never read from or written to the live device API.
export const previewDevice = {
  id: 'preview-box', nickname: 'Living room', exercise: true, status: 'normal',
  statusText: 'Sample device reporting normally. These readings are fictional.',
  lastSeen: '2026-11-08T15:00:00Z',
  conditions: [
    {label:'Water',text:'No water detected in this sample.'},
    {label:'Power',text:'Wall power connected in this sample.'},
    {label:'Connection',text:'Wi-Fi connected in this sample.'},
    {label:'Temperature',text:'24.6 °C · fictional reading'},
    {label:'Battery',text:'82% · fictional reading'},
  ], messages: [], help: {status:'none',text:'No follow-up recorded in this preview.'},
};
