import { ExtensionServices } from '../types';
import { PRCreatorPanel } from '../webviews/prCreatorPanel';

/** Retained export for integrations; both entry points use the same editable form and application service. */
export async function raisePRCommand(services: ExtensionServices): Promise<void> {
    PRCreatorPanel.createOrShow(services);
}
