import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const FORMAT_INFO = [
    { id: 'png',  label: 'PNG'  },
    { id: 'webp', label: 'WebP' },
    { id: 'avif', label: 'AVIF' },
];

const GRADIA_FLATPAK_ID = 'be.alexandervanhee.gradia';
const GRADIA_DESKTOP_ID = `${GRADIA_FLATPAK_ID}.desktop`;

function isGradiaInstalled() {
    const appInfo = Gio.DesktopAppInfo.new(GRADIA_DESKTOP_ID);
    if (!appInfo)
        return false;
    return !!appInfo.get_string('X-Flatpak');
}

const AboutPage = GObject.registerClass(
    class AboutPage extends Adw.PreferencesPage {
        constructor(settings) {
            super({
                title: 'Preferences',
                icon_name: 'org.gnome.Settings-symbolic',
            });
            this._settings = settings;
            this._setupCss();
            this._buildDonationGroup();
            this._buildTextRecognitionGroup();
            this._buildScreenshotGroup();
        }

        _setupCss() {
            const cssProvider = new Gtk.CssProvider();
            cssProvider.load_from_string(`
            .donation-card {
                background: linear-gradient(to bottom left, #1b5fc0, #159eff);
                border-radius: 12px;
                padding: 16px;
                color: white;
            }
        `);
            Gtk.StyleContext.add_provider_for_display(
                Gdk.Display.get_default(),
                cssProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            );
        }

        _buildDonationGroup() {
            const group = new Adw.PreferencesGroup();

            const card = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                hexpand: true,
                css_classes: ['donation-card'],
            });

            const labelBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 2,
                valign: Gtk.Align.CENTER,
                hexpand: true,
            });

            const title = new Gtk.Label({
                label: 'Support This Extension',
                halign: Gtk.Align.START,
                css_classes: ['title-4'],
                wrap: true
            });

            const subtitle = new Gtk.Label({
                label: 'If you enjoy my work, consider donating!',
                halign: Gtk.Align.START,
                wrap: true,
            });

            const button = new Gtk.LinkButton({
                label: 'Donate',
                uri: 'https://ko-fi.com/alexandervanhee',
                valign: Gtk.Align.CENTER,
                css_classes: ['pill'],
            });

            labelBox.append(title);
            labelBox.append(subtitle);
            card.append(labelBox);
            card.append(button);

            group.add(card);
            this.add(group);
        }

        _buildTextRecognitionGroup() {
            this._ocrGroup = new Adw.PreferencesGroup({ title: 'Text Recognition' });
            this.add(this._ocrGroup);
            this._ocrRow = null;
            this._refreshOcrRow();

            const monitor = Gio.AppInfoMonitor.get();
            this._appInfoMonitor = monitor;
            this._appInfoChangedId = monitor.connect('changed', () => this._refreshOcrRow());
        }

        _refreshOcrRow() {
            const installed = isGradiaInstalled();

            if (this._ocrRow) {
                this._ocrGroup.remove(this._ocrRow);
                this._ocrRow = null;
            }

            const row = new Adw.ActionRow(installed ? {
                title: 'Gradia Installed',
                subtitle: 'OCR text extraction is available in the screenshot UI',
            } : {
                title: 'Get the Gradia Flatpak',
                subtitle: 'Install the app via Flathub to enable the OCR text extraction feature',
                activatable: true,
            });

            row.add_suffix(new Gtk.Image({
                icon_name: installed ? 'object-select-symbolic' : 'go-next-symbolic',
                css_classes: installed ? ['success'] : [],
                valign: Gtk.Align.CENTER,
            }));

            if (!installed)
              row.connect('activated', () =>
                  Gtk.show_uri(null, `appstream://${GRADIA_FLATPAK_ID}`, Gdk.CURRENT_TIME));

            this._ocrGroup.add(row);
            this._ocrRow = row;
        }

        _buildScreenshotGroup() {
            const group = new Adw.PreferencesGroup({ title: 'Screenshot' });

            const availableIds = new Set(
                GdkPixbuf.Pixbuf.get_formats()
                    .filter(f => f.is_writable())
                    .map(f => f.get_name())
            );

            const formats = FORMAT_INFO.filter(f => availableIds.has(f.id));

            const formatRow = new Adw.ComboRow({
                title: 'File Format',
                subtitle: 'Changing this may slow down saving',
            });

            const model = new Gtk.StringList();
            for (const fmt of formats)
                model.append(fmt.label);

            formatRow.set_model(model);

            const currentFormat = this._settings.get_string('screenshot-format');
            const currentIndex = formats.findIndex(f => f.id === currentFormat);
            formatRow.set_selected(currentIndex >= 0 ? currentIndex : formats.findIndex(f => f.id === 'png'));

            formatRow.connect('notify::selected', () => {
                const selected = formats[formatRow.get_selected()];
                if (selected)
                    this._settings.set_string('screenshot-format', selected.id);
            });

            const clearSelectionRow = new Adw.SwitchRow({
                title: 'Disable Initial Selection',
                subtitle: 'Hide the default or last pre-selected area when the overlay opens',
            });

            this._settings.bind('clear-selection', clearSelectionRow, 'active', Gio.SettingsBindFlags.DEFAULT);

            const compositeWindowRow = new Adw.SwitchRow({
                title: 'Include Parent Windows',
                subtitle: 'Also capture parent windows when a transient window is selected',
            });

            this._settings.bind('composite-window-capture', compositeWindowRow, 'active', Gio.SettingsBindFlags.DEFAULT);

            const soundRow = new Adw.SwitchRow({
                title: 'Sound',
                subtitle: 'Play a shutter sound effect on capture',
            });

            this._settings.bind('play-sound', soundRow, 'active', Gio.SettingsBindFlags.DEFAULT);

            group.add(formatRow);
            group.add(clearSelectionRow);
            group.add(compositeWindowRow);
            group.add(soundRow);
            this.add(group);
        }
    });

const ShortcutsPage = GObject.registerClass(
    class ShortcutsPage extends Adw.PreferencesPage {
        constructor() {
            super({
                title: 'Shortcuts',
                icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            });

            this._addGroup('Screenshot Mode', [
                ['Take Screenshot / Capture',  'Return space'],
                ['Copy to Clipboard',          '<Control>c'],
                ['Save As…',                   '<Control>s'],
                ['Extract Text (OCR)',         '<Control>e'],
                ['Area Selection',             's'],
                ['Screen Selection',           'c'],
                ['Window Selection',           'w'],
                ['Toggle Pointer Visibility',  'p'],
                ['Toggle Screen Recording',    'v'],
            ]);

            this._addGroup('Annotations', [
                ['Undo Last Stroke',     '<Control>z'],
                ['Delete Selected',      'Delete BackSpace'],
                ['Crop Tool',            '1 q'],
                ['Drag Tool',            '2 d'],
                ['Freehand Tool',        '3 f'],
                ['Rectangle Tool',       '4 r'],
                ['Solid Rectangle Tool', '5 b'],
                ['Highlighter Tool',     '6 h'],
                ['Arrow Tool',           '7 a'],
                ['Text Tool',            '8 t'],
                ['Number Stamp Tool',    '9 n'],
            ]);

            this._addSystemKeybindingsGroup();
        }

        _addGroup(title, entries, note = null) {
            const group = new Adw.PreferencesGroup({ title });
            if (note)
                group.set_description(note);
            for (const [label, accel] of entries) {
                const row = new Adw.ActionRow({ title: label });
                const shortcut = new Adw.ShortcutLabel({ accelerator: accel });
                shortcut.set_valign(Gtk.Align.CENTER);
                row.add_suffix(shortcut);
                group.add(row);
            }
            this.add(group);
        }

        _addSystemKeybindingsGroup() {
            const shellSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.keybindings',
            });

            const entries = [
                ['Take a screenshot interactively', 'show-screenshot-ui'],
                ['Take a screencast interactively', 'show-screen-recording-ui'],
                ['Take a screenshot of a window', 'screenshot-window'],
                ['Take a screenshot', 'screenshot'],
            ];

            const group = new Adw.PreferencesGroup({ title: 'System Keybindings' });
            group.set_description('Configurable in Settings → Keyboard.');

            for (const [label, key] of entries) {
                const row = new Adw.ActionRow({ title: label });
                const accels = shellSettings.get_strv(key);
                const shortcut = new Adw.ShortcutLabel({ accelerator: accels[0] ?? '' });
                shortcut.set_valign(Gtk.Align.CENTER);
                row.add_suffix(shortcut);
                group.add(row);
            }

            this.add(group);
        }
    });

export default class GradiaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.add(new AboutPage(settings));
        window.add(new ShortcutsPage());
    }
}
