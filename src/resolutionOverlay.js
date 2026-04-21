import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MIN_W = 100;
const MIN_H = 50;
const FADE_DURATION = 400;

export class ResolutionOverlay {
    constructor(primaryBin) {
        this._primaryBin = primaryBin;
        this._visible = false;
        this._timeline = null;
        this._label = new St.Label({
            style_class: 'gradia-resolution-label',
            opacity: 0,
            visible: false,
        });
        this._primaryBin.add_child(this._label);
    }

    onDragStarted() {
        this._fadeIn();
        this._startPolling();
        this._update();
    }

    onDragEnded() {
        this._stopPolling();
        this._fadeOut();
    }

    _startPolling() {
        if (this._timeline)
            return;
        this._timeline = new Clutter.Timeline({
            actor: this._primaryBin,
            repeat_count: -1,
            duration: 100,
        });
        this._newFrameId = this._timeline.connect('new-frame', () => this._update());
        this._timeline.start();
    }

    _stopPolling() {
        if (!this._timeline)
            return;
        this._timeline.disconnect(this._newFrameId);
        this._timeline.stop();
        this._timeline = null;
        this._newFrameId = null;
    }

    _getMaxScale() {
        return Main.layoutManager.monitors.reduce((best, mon) => {
            const scale = mon.geometry_scale ?? global.stage.scale_factor ?? 1;
            return scale > best ? scale : best;
        }, 1);
    }

    _fadeIn() {
        if (this._visible)
            return;
        this._visible = true;
        this._label.remove_all_transitions();
        this._label.visible = true;
        this._label.ease({
            opacity: 255,
            duration: FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _fadeOut() {
        if (!this._visible)
            return;
        this._visible = false;
        this._label.remove_all_transitions();
        this._label.ease({
            opacity: 0,
            duration: FADE_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (!this._visible)
                    this._label.visible = false;
            },
        });
    }

    _update() {
        const selector = Main.screenshotUI?._areaSelector;
        if (!selector)
            return;

        const [x, y, w, h] = selector.getGeometry();

        if (w < MIN_W || h < MIN_H) {
            this._fadeOut();
            return;
        }

        if (!this._visible)
            this._fadeIn();

        const scale = this._getMaxScale();
        const physW = Math.round(w * scale);
        const physH = Math.round(h * scale);

        const [ok, localX, localY] = this._primaryBin.transform_stage_point(
            x + w / 2,
            y + h / 2,
        );

        if (!ok)
            return;

        this._label.set_text(`${physW}×${physH}`);

        const [, natW] = this._label.get_preferred_width(-1);
        const [, natH] = this._label.get_preferred_height(-1);

        this._label.set_position(
            Math.round(localX - natW / 2),
            Math.round(localY - natH / 2),
        );
    }

    destroy() {
        this._stopPolling();
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        this._primaryBin = null;
    }
}
