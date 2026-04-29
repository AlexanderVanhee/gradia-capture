import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { attachTooltip } from './tooltip.js';
import { GradiaSettings } from './settings.js';

export const GRADIA_FLATPAK_ID = 'be.alexandervanhee.gradia.Devel';
const GRADIA_DESKTOP_ID = `${GRADIA_FLATPAK_ID}.desktop`;
const GRADIA_KEYFILE_PATH = GLib.build_filenamev([
    GLib.get_home_dir(),
    '.var', 'app', GRADIA_FLATPAK_ID,
    'config', 'glib-2.0', 'settings', 'keyfile',
]);


export function isGradiaFlatpakInstalled() {
    const appInfo = Shell.AppSystem.get_default().lookup_app(GRADIA_DESKTOP_ID)?.get_app_info();
    if (!appInfo)
        return false;
    return !!appInfo.get_string('X-Flatpak');
}

export function launchGradiaForScreenshot(file) {
    if (!file) return;
    const objectPath = '/' + GRADIA_FLATPAK_ID.replaceAll('.', '/');
    Gio.DBus.session.call(
        GRADIA_FLATPAK_ID, objectPath,
        'org.freedesktop.Application', 'ActivateAction',
        new GLib.Variant('(sava{sv})', [
            'open',
            [new GLib.Variant('s', file.get_path())],
            {},
        ]),
        null, Gio.DBusCallFlags.NONE, -1, null, null
    );
}

export function openContainingFolder(file) {
    Gio.DBus.session.call(
        'org.freedesktop.FileManager1',
        '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1',
        'ShowItems',
        new GLib.Variant('(ass)', [[file.get_uri()], '']),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
        null
    );
}

export function readGradiaExportSettings() {
    const fallback = { valid: false, providerName: null, customExportCommand: null, showExportConfirmDialog: true };

    if (!Gio.File.new_for_path(GRADIA_KEYFILE_PATH).query_exists(null))
        return fallback;

    const keyfile = new GLib.KeyFile();
    try {
        if (!keyfile.load_from_file(GRADIA_KEYFILE_PATH, GLib.KeyFileFlags.NONE))
            return fallback;
    } catch (e) {
        return fallback;
    }

    const group = 'be/alexandervanhee/gradia';
    if (!keyfile.has_group(group))
        return fallback;

    const keys = new Set(keyfile.get_keys(group)[0] ?? []);

    const unescape = (s) => s.replace(/\\(.)/g, (_, c) =>
        c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c);

    const get = (key) => {
        if (!keys.has(key)) return null;
        try {
            return unescape(keyfile.get_value(group, key).replace(/^['"]|['"]$/g, ''));
        } catch (e) {
            return null;
        }
    };

    const providerName = get('provider-name');
    const customExportCommand = get('custom-export-command');
    const rawBool = get('show-export-confirm-dialog');

    return {
        valid: providerName !== null && customExportCommand !== null,
        providerName,
        customExportCommand,
        showExportConfirmDialog: rawBool === 'false' ? false : true,
    };
}

export function openFileInDefaultApp(file) {
    Gio.app_info_launch_default_for_uri(
        file.get_uri(),
        global.create_app_launch_context(0, -1)
    );
}

export function launchGradiaOcrForFile(file) {
    if (!file)
        return;
    const path = file.get_path();
    if (!path)
        return;
    try {
        Gio.Subprocess.new(
            ['flatpak', 'run', GRADIA_FLATPAK_ID, `--ocr-file=${path}`],
            Gio.SubprocessFlags.NONE
        );
    } catch (e) {
        console.error(`Failed to spawn Gradia: ${e.message}`);
    }
}

export function launchGradiaPin(file) {
    if (!file?.get_path()) return;

    const stickPinned = GradiaSettings.getInstance()?.settings.get_boolean('pin-stick') ?? false;
    const objectPath = '/' + GRADIA_FLATPAK_ID.replaceAll('.', '/');


    const getGradiaWindows = () =>
        global.get_window_actors()
            .map(a => a.meta_window)
            .filter(w => w.get_wm_class()?.startsWith(GRADIA_FLATPAK_ID));

    const before = new Set(getGradiaWindows().map(w => w.get_id()));

    Gio.DBus.session.call(
        GRADIA_FLATPAK_ID,
        objectPath,
        'org.freedesktop.Application',
        'ActivateAction',
        new GLib.Variant('(sava{sv})', [
            'pin',
            [new GLib.Variant('s', file.get_path())],
            {},
        ]),
        null, Gio.DBusCallFlags.NONE, -1, null,
        (conn, res) => {
            try {
                conn.call_finish(res);
            } catch (e) {
                console.error(`[GradiaPin] D-Bus call failed: ${e.message}`);
                return;
            }

            let tries = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {

                getGradiaWindows()
                    .filter(w => !before.has(w.get_id()))
                    .forEach(w => {
                        w.make_above();
                        if (stickPinned)
                          w.stick();
                    });
                return ++tries < 20 ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE;
            });
        }
    );
}

export function createOcrButton(onClick) {
    const button = new St.Button({
        style_class: 'screenshot-ui-show-pointer-button',
        icon_name: 'scanner-symbolic',
        toggle_mode: false,
    });
    button.connect('clicked', () => onClick());
    attachTooltip(button, 'Extract Text', St.Side.TOP);
    return button;
}

export function createSettingsButton(onClick) {
    const button = new St.Button({
        style_class: 'screenshot-ui-show-pointer-button',
        icon_name: 'org.gnome.Settings-symbolic',
        toggle_mode: false,
    });
    button.connect('clicked', () => onClick());
    attachTooltip(button, 'Settings', St.Side.TOP);
    return button;
}

export function setOcrButtonEnabled(button, enabled) {
    if (!button)
        return;
    button.reactive = enabled;
    button.ease({
        opacity: enabled ? 255 : 80,
        duration: 200,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}
