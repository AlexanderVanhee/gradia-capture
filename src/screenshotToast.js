import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { isGradiaFlatpakInstalled, launchGradiaForScreenshot, openContainingFolder, openFileInDefaultApp } from './gradiaIntegration.js';

const TOAST_WIDTH = 250;
const TOAST_MARGIN = 18;
const ANIMATION_TIME = 150;
const CLOSE_ANIMATION_TIME = 150;
const AUTO_HIDE_TIMEOUT = 3000;
const CLOSE_BUTTON_SIZE = 32;
const CLOSE_BUTTON_OFFSET = CLOSE_BUTTON_SIZE / 2;
const MIN_THUMB_H = 150;
const MAX_THUMB_H = 250;

let _activeToast = null;

class ScreenshotToast {
    constructor(file, imageContent, imgW, imgH, showCopied = false) {
        this._file = file;
        this._timeoutId = 0;
        this._signalIds = [];

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
                background-color: #222226;
                box-shadow: 0 0 8px rgba(0,0,0,0.35);
            `,
        });
        this._shadowLayer.set_size(TOAST_WIDTH, thumbH);
        this._shadowLayer.set_position(0, CLOSE_BUTTON_OFFSET);
        this._outerContainer.add_child(this._shadowLayer);

        this._mainButton = new St.Button({
            reactive: true,
            clip_to_allocation: true,
            style: 'background: transparent;',
        });
        this._mainButton.set_size(TOAST_WIDTH, thumbH);
        this._mainButton.set_position(0, CLOSE_BUTTON_OFFSET);
        this._outerContainer.add_child(this._mainButton);

        this._contentLayer = new St.Widget();
        this._contentLayer.set_size(TOAST_WIDTH, thumbH);
        this._mainButton.set_child(this._contentLayer);

        if (imageContent) {
            let fitW, fitH;
            if (imgW > 0 && imgH > 0) {
                const scale = Math.max(TOAST_WIDTH / imgW, thumbH / imgH);
                fitW = Math.round(imgW * scale);
                fitH = Math.round(imgH * scale);
            } else {
                fitW = TOAST_WIDTH;
                fitH = thumbH;
            }

            const offX = Math.round((TOAST_WIDTH - fitW) / 2);
            const offY = Math.round((thumbH - fitH) / 2);

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

        const btnMargin = 10;

        if (file && isGradiaFlatpakInstalled()) {
            this._editButton = new St.Button({
                style_class: 'gradia-circle-button gradia-selection-trash',
                child: new St.Icon({
                    icon_name: 'document-edit-symbolic',
                    style: 'icon-size: 16px;',
                }),
                reactive: true,
            });

            this._contentLayer.add_child(this._editButton);

            this._signalIds.push([this._editButton, this._editButton.connect('realize', () => {
                this._editButton.set_size(CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE);
                this._editButton.set_position(btnMargin, thumbH - CLOSE_BUTTON_SIZE - btnMargin);
            })]);

            this._signalIds.push([this._editButton, this._editButton.connect('clicked', () => {
                launchGradiaForScreenshot(file);
                this.destroy();
            })]);
        }

        if (file) {
            this._openFolderButton = new St.Button({
                style_class: 'gradia-circle-button gradia-selection-trash',
                child: new St.Icon({
                    icon_name: 'folder-open-symbolic',
                    style: 'icon-size: 16px;',
                }),
                reactive: true,
            });

            this._contentLayer.add_child(this._openFolderButton);

            this._signalIds.push([this._openFolderButton, this._openFolderButton.connect('realize', () => {
                this._openFolderButton.set_size(CLOSE_BUTTON_SIZE, CLOSE_BUTTON_SIZE);
                this._openFolderButton.set_position(TOAST_WIDTH - CLOSE_BUTTON_SIZE - btnMargin, thumbH - CLOSE_BUTTON_SIZE - btnMargin);
            })]);

            this._signalIds.push([this._openFolderButton, this._openFolderButton.connect('clicked', () => {
                openContainingFolder(file);
                this.destroy();
            })]);
        }

        if (showCopied) {
            this._copiedLabel = new St.BoxLayout({
                style_class: 'gradia-copied-label',
            });

            const checkIcon = new St.Icon({
                icon_name: 'object-select-symbolic',
                icon_size: 16,
            });

            const label = new St.Label({
                text: 'Copied!',
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });

            this._copiedLabel.add_child(checkIcon);
            this._copiedLabel.add_child(label);

            this._contentLayer.add_child(this._copiedLabel);
            this._signalIds.push([this._copiedLabel, this._copiedLabel.connect('realize', () => {
                const [, naturalW] = this._copiedLabel.get_preferred_width(-1);
                const [, naturalH] = this._copiedLabel.get_preferred_height(-1);
                this._copiedLabel.set_position(
                    Math.round((TOAST_WIDTH - naturalW) / 2),
                    Math.round((thumbH - naturalH) / 2)
                );
            })]);
        }

        this._signalIds.push([this._mainButton, this._mainButton.connect('clicked', () => {
            if (this._file)
                openFileInDefaultApp(this._file);
            this.destroy();
        })]);

        const borderOverlay = new St.Widget({
            style_class: 'gradia-toast-border',
            reactive: false,
        });
        borderOverlay.set_size(TOAST_WIDTH + 7, thumbH + 7);
        borderOverlay.set_position(-3.5, CLOSE_BUTTON_OFFSET - 3.5);
        this._outerContainer.add_child(borderOverlay);

        this._closeButton = new St.Button({
            style_class: 'gradia-circle-button gradia-selection-trash',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                style: 'icon-size: 16px;',
            }),
            reactive: true,
        });
        this._closeButton.set_position(TOAST_WIDTH - CLOSE_BUTTON_OFFSET + 1, -1);
        this._signalIds.push([this._closeButton, this._closeButton.connect('clicked', () => this.destroy())]);
        this._outerContainer.add_child(this._closeButton);

        this._signalIds.push([this._outerContainer, this._outerContainer.connect('notify::hover', () => {
            if (this._outerContainer.hover)
                this._clearTimeout();
            else
                this._scheduleHide();
        })]);

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
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
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
        this._clearTimeout();

        for (const [obj, id] of this._signalIds)
            obj.disconnect(id);
        this._signalIds = [];

        this._outerContainer.ease({
            y: this._outerContainer.y + this._outerContainer.height + TOAST_MARGIN + 10,
            opacity: 0,
            duration: CLOSE_ANIMATION_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => {
                Main.layoutManager.removeChrome(this._outerContainer);
                this._outerContainer.destroy();
                this._outerContainer = null;
            },
        });

        if (_activeToast === this)
            _activeToast = null;
    }
}

export function showScreenshotToast(file, imageContent, imgW, imgH, showCopied = false) {
    _activeToast?.destroy();
    _activeToast = new ScreenshotToast(file, imageContent, imgW, imgH, showCopied);
}

export function destroyActiveToast() {
    _activeToast?.destroy();
    _activeToast = null;
}
