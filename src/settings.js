import GLib from 'gi://GLib';

const SCHEMA_ID = 'org.gnome.shell.extensions.gradia-companion';

let _instance = null;

export class GradiaSettings {
    constructor(extension) {
        this._settings = extension.getSettings(SCHEMA_ID);
        _instance = this;
    }

    static getInstance() {
        return _instance;
    }

    get settings() {
        return this._settings;
    }

    loadToolSettings() {
        const variant = this._settings.get_value('tool-settings');
        const map = new Map();

        const nChildren = variant.n_children();
        for (let i = 0; i < nChildren; i++) {
            const entry = variant.get_child_value(i);
            const toolId = entry.get_child_value(0).get_string()[0];
            const tuple = entry.get_child_value(1);
            const color = tuple.get_child_value(0).get_string()[0];
            const lineWidth = tuple.get_child_value(1).get_double();
            map.set(toolId, { color, lineWidth });
        }

        return map;
    }

    saveToolSettings(map) {
        const entries = [];

        for (const [toolId, { color, lineWidth }] of map) {
            const tuple = GLib.Variant.new_tuple([
                GLib.Variant.new_string(color),
                GLib.Variant.new_double(lineWidth),
            ]);
            const entry = GLib.Variant.new_dict_entry(
                GLib.Variant.new_string(toolId),
                tuple
            );
            entries.push(entry);
        }

        const variant = GLib.Variant.new_array(
            GLib.VariantType.new('{s(sd)}'),
            entries
        );

        this._settings.set_value('tool-settings', variant);
    }

    saveToolEntry(toolId, color, lineWidth) {
        const map = this.loadToolSettings();
        map.set(toolId, { color, lineWidth });
        this.saveToolSettings(map);
    }

    getToolEntry(toolId, defaultColor, defaultLineWidth) {
        const map = this.loadToolSettings();
        return map.get(toolId) ?? { color: defaultColor, lineWidth: defaultLineWidth };
    }

    destroy() {
        this._settings = null;
        if (_instance === this)
            _instance = null;
    }
}
