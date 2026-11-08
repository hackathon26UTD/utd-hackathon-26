import {syncDeviceHistory} from '../../../src/device-history-sync.js';
export const onRequest=ctx=>syncDeviceHistory(ctx);
