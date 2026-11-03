/* eslint-disable no-control-regex -- Trust-boundary input validation explicitly rejects control characters. */
import { safeOrganizationUrl } from '../branchFlow/domain/model';
/** Only organization-scoped HTTP UI links can be opened; imported command/file/javascript URLs are rejected. */
export function safeAzureLink(value: unknown, organizationUrl: string): string | undefined {
    if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x20\\]/.test(value)) { return; }
    try {
        const base = new URL(safeOrganizationUrl(organizationUrl)); const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.origin !== base.origin ||
            !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')) { return; }
        return url.toString();
    } catch { return; }
}
