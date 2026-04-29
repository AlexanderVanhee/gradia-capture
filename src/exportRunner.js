import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';

import { GRADIA_FLATPAK_ID } from './gradiaIntegration.js';

class ExportConfirmDialog extends ModalDialog.ModalDialog {
    static {
        GObject.registerClass(this);
    }

    constructor(providerName, onConfirm) {
        super({ styleClass: 'end-session-dialog', destroyOnClose: true });

        this._messageDialogContent = new Dialog.MessageDialogContent();
        this.contentLayout.add_child(this._messageDialogContent);

        this._messageDialogContent.title = 'Upload Screenshot?';
        this._messageDialogContent.description =
            `The screenshot will be uploaded via the ${providerName} provider.`;

        this.addButton({
            label: 'Cancel',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });

        this.addButton({
            label: 'Upload',
            action: () => {
                this.close();
                onConfirm();
            },
            default: true,
        });
    }
}

function _getNotificationSource() {
    const existing = Main.messageTray.getSources()
        .find(s => s.title === 'Gradia Export');
    if (existing)
        return existing;

    const source = new MessageTray.Source({
        title: 'Screen Capture',
        iconName: 'screenshooter-symbolic',
    });
    Main.messageTray.add(source);
    return source;
}

function _notify(title, body, urgency = MessageTray.Urgency.NORMAL) {
    const source = _getNotificationSource();
    const notification = new MessageTray.Notification({
        source,
        title,
        body,
        urgency,
        isTransient: true,
    });
    source.addNotification(notification);
}

function _notifyLinkCopied(url) {
    const source = _getNotificationSource();
    const notification = new MessageTray.Notification({
        source,
        title: 'Screenshot link created',
        body: 'You can paste it from the clipboard',
        isTransient: true,
    });

    notification.addAction('Open Link', () => {
       Gio.AppInfo.launch_default_for_uri(url, null);
    });

    source.addNotification(notification);
}

function _copyToClipboard(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}

function _runExportCommand(file, command) {
    const path = file.get_path();
    if (!path) {
        _notify('Export failed', 'No file path available.', MessageTray.Urgency.HIGH);
        return;
    }

    const argv = ['flatpak', 'run', '--command=bash', GRADIA_FLATPAK_ID, '-c', command, '_', path];

    let proc;
    try {
        proc = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
    } catch (e) {
        console.error(`Failed to spawn: ${e.message}`);
        _notify('Export failed', e.message, MessageTray.Urgency.HIGH);
        return;
    }

    proc.communicate_utf8_async(null, null, (p, res) => {
        try {
            const [, stdout, stderr] = p.communicate_utf8_finish(res);

            if (!p.get_successful()) {
                _notify('Export failed', stderr?.trim() || 'Unknown error', MessageTray.Urgency.HIGH);
                return;
            }

            const link = (stdout ?? '').trim().split(/\r?\n/).filter(Boolean).pop();
            if (!link) {
                _notify('Export failed', 'No URL returned by export command.', MessageTray.Urgency.HIGH);
                return;
            }

            _copyToClipboard(link);
            _notifyLinkCopied(link);
        } catch (e) {
            console.error(`[GradiaExport] communicate_utf8_finish threw: ${e.message}`);
            _notify('Export failed', e.message, MessageTray.Urgency.HIGH);
        }
    });
}

export function runExport(file, settings) {
    if (!file || !settings?.valid)
        return;

    const execute = () => _runExportCommand(file, settings.customExportCommand);

    if (settings.showExportConfirmDialog) {
        const dialog = new ExportConfirmDialog(settings.providerName, execute);
        dialog.open();
    } else {
        execute();
    }
}
