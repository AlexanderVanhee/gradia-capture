import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEFAULT_GAP = 6;

export const Tooltip = GObject.registerClass(
    class Tooltip extends St.Label {
        _init(widget, text, side = St.Side.BOTTOM) {
            super._init({
                text,
                style_class: 'screenshot-ui-tooltip',
                visible: false,
            });
            this._timeoutId = null;
            this._side = side;
            widget.connect('notify::hover', () => {
                if (widget.hover)
                    this._scheduleShow(widget);
                else
                    this._hide();
            });
        }
        
        destroy() {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = null;
            }
            super.destroy();
        }
        
        _scheduleShow(widget) {
            if (this._timeoutId)
                return;
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._timeoutId = null;
                this._show(widget);
                return GLib.SOURCE_REMOVE;
            });
        }
        _getGap() {
            if (this._side !== St.Side.TOP)
                return DEFAULT_GAP;
            const node = this.get_theme_node();
            const gap = node?.get_length('-y-offset');
            return gap > 0 ? gap : DEFAULT_GAP;
        }
        _show(widget) {
            const e = widget.get_transformed_extents();
            const [wx, wy, ww, wh] = [e.get_x(), e.get_y(), e.get_width(), e.get_height()];
            const cx = Math.floor(wx + (ww - this.width) / 2);
            const cy = Math.floor(wy + (wh - this.height) / 2);
            const gap = this._getGap();
            const positions = {
                [St.Side.TOP]:    [cx, wy - this.height - gap],
                [St.Side.BOTTOM]: [cx, wy + wh + gap],
                [St.Side.LEFT]:   [wx - this.width - gap, cy],
                [St.Side.RIGHT]:  [wx + ww + gap, cy],
            };
            const [x, y] = positions[this._side] ?? positions[St.Side.BOTTOM];
            this.set_position(x, y);
            this.show();
        }
        _hide() {
            if (this._timeoutId) {
                GLib.source_remove(this._timeoutId);
                this._timeoutId = null;
            }
            this.hide();
        }
    });

export function attachTooltip(widget, text, side = St.Side.BOTTOM) {
    const tooltip = new Tooltip(widget, text, side);
    Main.uiGroup.add_child(tooltip);
    return tooltip;
}
