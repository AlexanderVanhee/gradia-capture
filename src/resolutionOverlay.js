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
        this._motionId = null;
        this._motionSource = null;

        this._label = new St.Label({
            style_class: 'gradia-resolution-label',
            opacity: 0,
            visible: false,
        });
        this._primaryBin.add_child(this._label);
    }

    onDragStarted() {
        // GNOME 51: stopDrag() can emit 'drag-ended' from reset(), so start and end
        // are not strictly paired. Never leave a previous connection behind.
        this._disconnectMotion();
        this._fadeIn();
        const selector = Main.screenshotUI?._areaSelector;
        if (selector?._panGesture) {
            // GNOME 51: once the pan gesture recognizes, actors leave the event
            // chain and 'motion-event' stops firing for the rest of the drag.
            this._motionSource = selector._panGesture;
            this._motionId = this._motionSource.connect('pan-update', () => this._update());
        } else if (selector) {
            this._motionSource = selector;
            this._motionId = selector.connect('motion-event', () => {
                this._update();
                return Clutter.EVENT_PROPAGATE;
            });
        }
        this._update();
    }

    onDragEnded() {
        this._disconnectMotion();
        this._fadeOut();
    }

    _disconnectMotion() {
        if (this._motionSource && this._motionId)
            this._motionSource.disconnect(this._motionId);
        this._motionSource = null;
        this._motionId = null;
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
        this._disconnectMotion();
        if (this._label) {
            this._label.destroy();
            this._label = null;
        }
        this._primaryBin = null;
    }
}
