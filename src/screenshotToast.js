import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GioUnix from 'gi://GioUnix';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TOAST_WIDTH = 250;
const TOAST_MARGIN = 24;
const ANIMATION_TIME = 250;
const CLOSE_ANIMATION_TIME = 150;
const AUTO_HIDE_TIMEOUT = 4000;
const CLOSE_BUTTON_SIZE = 32;
const CLOSE_BUTTON_OFFSET = CLOSE_BUTTON_SIZE / 2;
const MIN_THUMB_H = 100;
const MAX_THUMB_H = 250;

let _activeToast = null;

function _isGradiaInstalled() {
    const appInfo = GioUnix.DesktopAppInfo.new('be.alexandervanhee.gradia.desktop');
    return appInfo !== null;
}

class ScreenshotToast {
    constructor(file, imageContent, imgW, imgH) {
        this._file = file;
        this._timeoutId = 0;
        this._destroyed = false;

        let thumbH = 140;
        if (imgW > 0 && imgH > 0)
            thumbH = Math.round(TOAST_WIDTH * (imgH / imgW));

        thumbH = Math.max(MIN_THUMB_H, Math.min(MAX_THUMB_H, thumbH));

        this._outerContainer = new St.Widget({
            reactive: true,
            track_hover: true,
        });
        this._outerContainer.set_size(
            TOAST_WIDTH + CLOSE_BUTTON_OFFSET,
            thumbH + CLOSE_BUTTON_OFFSET
        );

        this._shadowLayer = new St.Widget({
            style: `
                background-color: #c8c8ca;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18),
                            0 1px 3px rgba(0, 0, 0, 0.12);
            `,
        });
        this._shadowLayer.set_size(TOAST_WIDTH, thumbH);
        this._shadowLayer.set_position(0, CLOSE_BUTTON_OFFSET);
        this._outerContainer.add_child(this._shadowLayer);

        this._contentLayer = new St.Widget({
            reactive: true,
            clip_to_allocation: true,
        });
        this._contentLayer.set_size(TOAST_WIDTH, thumbH);
        this._contentLayer.set_position(0, CLOSE_BUTTON_OFFSET);
        this._outerContainer.add_child(this._contentLayer);

        if (imageContent) {
            let fitW, fitH, offX, offY;

            if (imgW > 0 && imgH > 0) {
                const scale = Math.max(TOAST_WIDTH / imgW, thumbH / imgH);
                fitW = Math.round(imgW * scale);
                fitH = Math.round(imgH * scale);
            } else {
                fitW = TOAST_WIDTH;
                fitH = thumbH;
            }

            offX = Math.round((TOAST_WIDTH - fitW) / 2);
            offY = Math.round((thumbH - fitH) / 2);

            const img = new Clutter.Actor({
                width: fitW,
                height: fitH,
            });
            img.set_position(offX, offY);
            img.set_content(imageContent);
            img.set_content_scaling_filters(
                Clutter.ScalingFilter.TRILINEAR,
                Clutter.ScalingFilter.LINEAR);
            this._contentLayer.add_child(img);
        }

        const btnMargin = 8;
        const btnH = 28;

        if (file && _isGradiaInstalled()) {
            this._editButton = new St.Button({
                style_class: 'gradia-pill-button gradia-osd-button',
                label: 'Edit',
                reactive: true,
            });

            this._editButton.set_position(btnMargin, thumbH - btnH - btnMargin);
            this._contentLayer.add_child(this._editButton);

            this._editButton.connect('realize', () => {
                const [, naturalW] = this._editButton.get_preferred_width(-1);
                this._editButton.set_size(naturalW, btnH);
            });

            this._editButton.connect('clicked', () => {
                const appInfo = GioUnix.DesktopAppInfo.new('be.alexandervanhee.gradia.desktop');
                if (appInfo)
                    appInfo.launch([file], global.create_app_launch_context(0, -1));

                this.destroy();
            });
        }

        if (file) {
            this._openFolderButton = new St.Button({
                style_class: 'gradia-pill-button gradia-osd-button',
                label: 'Open Folder',
                reactive: true,
            });

            this._openFolderButton.set_position(btnMargin, thumbH - btnH - btnMargin);
            this._contentLayer.add_child(this._openFolderButton);

            this._openFolderButton.connect('realize', () => {
                const [, naturalW] = this._openFolderButton.get_preferred_width(-1);
                this._openFolderButton.set_size(naturalW, btnH);

                if (this._editButton) {
                    this._openFolderButton.set_position(
                        TOAST_WIDTH - naturalW - btnMargin,
                        thumbH - btnH - btnMargin
                    );
                } else {
                    this._openFolderButton.set_position(
                        Math.round((TOAST_WIDTH - naturalW) / 2),
                        thumbH - btnH - btnMargin
                    );
                }
            });

            this._openFolderButton.connect('clicked', () => {
                try {
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
                } catch (_e) {
                    const app = Gio.app_info_get_default_for_type('inode/directory', false);
                    if (app !== null) {
                        const parent = file.get_parent();
                        if (parent)
                            app.launch([parent], global.create_app_launch_context(0, -1));
                    }
                }
                this.destroy();
            });
        }

        this._contentLayer.connect('button-release-event', (_actor, event) => {
            const buttons = [this._editButton, this._openFolderButton];
            for (const btn of buttons) {
                if (!btn) continue;
                const [ex, ey] = event.get_coords();
                const [bx, by] = btn.get_transformed_position();
                if (ex >= bx && ex <= bx + btn.width && ey >= by && ey <= by + btn.height)
                    return Clutter.EVENT_PROPAGATE;
            }
            if (this._file) {
                Gio.app_info_launch_default_for_uri(
                    this._file.get_uri(),
                    global.create_app_launch_context(0, -1));
            }
            this.destroy();
            return Clutter.EVENT_STOP;
        });

        this._closeButton = new St.Button({
            style_class: 'gradia-circle-button gradia-osd-button',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                style: 'icon-size: 16px;',
            }),
            reactive: true,
        });
        this._closeButton.set_position(TOAST_WIDTH - CLOSE_BUTTON_OFFSET, 0);
        this._closeButton.connect('clicked', () => this.destroy());
        this._outerContainer.add_child(this._closeButton);

        this._outerContainer.connect('notify::hover', () => {
            if (this._outerContainer.hover)
                this._clearTimeout();
            else
                this._scheduleHide();
        });

        this._addToStage();
        this._scheduleHide();
    }

    _addToStage() {
        Main.layoutManager.addChrome(this._outerContainer);

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const targetX = monitor.x + monitor.width - TOAST_WIDTH - TOAST_MARGIN - CLOSE_BUTTON_OFFSET;
        const targetY = monitor.y + monitor.height - this._outerContainer.height - TOAST_MARGIN - CLOSE_BUTTON_OFFSET;
        const hiddenY = monitor.y + monitor.height + 10;

        this._outerContainer.set_position(targetX, hiddenY);
        this._outerContainer.opacity = 0;
        this._outerContainer.show();

        this._outerContainer.ease({
            y: targetY,
            opacity: 255,
            duration: ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _scheduleHide() {
        this._clearTimeout();
        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            AUTO_HIDE_TIMEOUT,
            () => {
                this._timeoutId = 0;
                this.destroy();
                return GLib.SOURCE_REMOVE;
            });
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._clearTimeout();

        this._outerContainer.ease({
            y: this._outerContainer.y + this._outerContainer.height + TOAST_MARGIN + 10,
            opacity: 0,
            duration: CLOSE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                Main.layoutManager.removeChrome(this._outerContainer);
                this._outerContainer.destroy();
            },
        });

        if (_activeToast === this)
            _activeToast = null;
    }
}

export function showScreenshotToast(file, imageContent, imgW, imgH) {
    _activeToast?.destroy();
    _activeToast = new ScreenshotToast(file, imageContent, imgW, imgH);
}
