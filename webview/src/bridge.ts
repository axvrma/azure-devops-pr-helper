import type { HostMessage } from '../../src/branchFlow/protocol';
interface VSCodeApi { postMessage(message: HostMessage): void; getState(): unknown; setState(state: unknown): void }
declare function acquireVsCodeApi(): VSCodeApi;
export const bridge = acquireVsCodeApi();
export const action = (name: Extract<HostMessage, { type: 'action' }>['action']): void => bridge.postMessage({ type: 'action', action: name });
