import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import { gettext as _ } from "./i18n.js";
import { Slider } from "resource:///org/gnome/shell/ui/slider.js";

import { TOOLS } from "./tools.js";
import { attachTooltip } from "./tooltip.js";

export const TRASH_BUTTON_RADIUS = 16;

const COLORS = [
	{ name: "White", hex: "#ffffff" },
	{ name: "Black", hex: "#000000" },
	{ name: "Red", hex: "#ff4444" },
	{ name: "Orange", hex: "#ff8800" },
	{ name: "Yellow", hex: "#ffdd00" },
	{ name: "Green", hex: "#44cc44" },
	{ name: "Blue", hex: "#4488ff" },
	{ name: "Purple", hex: "#aa44ff" },
];

function makeIcon(spec, extensionPath = "") {
	if (spec.startsWith("/") || spec.startsWith("icons/")) {
		const fullPath = spec.startsWith("/")
			? spec
			: `${extensionPath}/${spec}`;
		return new St.Icon({
			gicon: Gio.Icon.new_for_string(fullPath),
			style: "icon-size: 16px;",
		});
	}
	return new St.Icon({
		icon_name: spec,
		style: "icon-size: 16px;",
	});
}

const LINE_WIDTH_MIN = 1;
const LINE_WIDTH_MAX = 16;

export const Toolbar = GObject.registerClass(
	{
		Signals: {
			"tool-changed": { param_types: [GObject.TYPE_STRING] },
			"color-changed": { param_types: [GObject.TYPE_STRING] },
			"line-width-changed": { param_types: [GObject.TYPE_DOUBLE] },
			undo: {},
			clear: {},
		},
	},
	class Toolbar extends St.BoxLayout {
		_init(params = {}) {
			const {
				extensionPath = "",
				gradiaSettings = null,
				...rest
			} = params;
			this._extensionPath = extensionPath;
			this._settings = gradiaSettings;

			super._init({
				style_class: "screenshot-ui-panel gradia-toolbar",
				x_align: Clutter.ActorAlign.CENTER,
				y_align: Clutter.ActorAlign.START,
				y_expand: true,
				reactive: true,
				...rest,
			});

			this._selectedColor = COLORS[1].hex;
			this._selectedTool = TOOLS[0].id;
			this._lineWidth = 4;
			this._colorButtons = [];
			this._toolButtons = [];

			this._buildToolButtons();
			this._addSeparator();
			this._buildColorButtons();
			this._addSeparator();
			this._buildLineWidthSlider();
			this._addSeparator();
			this._buildActionButtons();

			this._restoreToolEntry(this._selectedTool);
			this._updateDrawingControlsSensitivity();
		}

		_currentToolIsDrawing() {
			return (
				TOOLS.find((t) => t.id === this._selectedTool)?.isDrawing ??
				false
			);
		}

		_updateDrawingControlsSensitivity() {
			const drawing = this._currentToolIsDrawing();
			const hasSelection = this._hasSelection?.() ?? false;
			const enabled = drawing || hasSelection;

			for (const btn of this._colorButtons) {
				btn.reactive = enabled;
				btn.opacity = enabled ? 255 : 80;
				if (!enabled) btn.style = "border-color: transparent;";
			}
			this._slider.reactive = enabled;
			this._slider.opacity = enabled ? 255 : 80;
		}

		_saveCurrentToolEntry() {
			this._settings?.saveToolEntry(
				this._selectedTool,
				this._selectedColor,
				this._lineWidth,
			);
		}

		_restoreToolEntry(toolId) {
			if (!this._settings) return;
			const { color, lineWidth } = this._settings.getToolEntry(
				toolId,
				this._selectedColor,
				this._lineWidth,
			);
			this._applyColor(color);
			this._applyLineWidth(lineWidth);
		}

		_applyColor(hex) {
			this._selectedColor = hex;
			for (const btn of this._colorButtons) {
				const selected = btn._colorHex === hex;
				btn.style = `border-color: ${selected ? btn._colorHex : "transparent"};`;
				btn._swatch.style = `background-color: ${btn._colorHex};`;
			}
			this.emit("color-changed", hex);
		}

		_applyLineWidth(width) {
			this._lineWidth = width;
			this._slider.value =
				(width - LINE_WIDTH_MIN) / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
			this.emit("line-width-changed", width);
		}

		_syncToStroke(stroke) {
			this._applyColor(stroke.color);
			this._applyLineWidth(stroke.strokeWidth);
		}

		_buildToolButtons() {
			for (let i = 0; i < TOOLS.length; i++) {
				const tool = TOOLS[i];
				const btn = new St.Button({
					child: makeIcon(tool.icon, this._extensionPath),
					style_class:
						"screenshot-ui-type-button gradia-square-button",
					toggle_mode: true,
					checked: tool.id === this._selectedTool,
					y_align: Clutter.ActorAlign.CENTER,
				});
				btn._toolId = tool.id;
				btn.connect("clicked", () => this._onToolClicked(tool.id));
				this.add_child(btn);
				this._toolButtons.push(btn);

				btn._tooltip = attachTooltip(btn, _(tool.name));

				if (i === 1) this._addSeparator();
			}
		}

		_buildColorButtons() {
			for (const color of COLORS) {
				const selected = color.hex === this._selectedColor;

				const ring = new St.Button({
					style_class: "gradia-ring-button",
					style: `border-color: ${selected ? color.hex : "transparent"};`,
					y_align: Clutter.ActorAlign.CENTER,
					layout_manager: new Clutter.BinLayout(),
				});

				const swatch = new St.Widget({
					style_class: "gradia-swatch",
					style: `background-color: ${color.hex};`,
					y_align: Clutter.ActorAlign.CENTER,
				});

				ring._colorHex = color.hex;
				ring._swatch = swatch;

				ring.add_child(swatch);
				ring.connect("clicked", () => this._onColorClicked(color.hex));
				this.add_child(ring);
				this._colorButtons.push(ring);

				attachTooltip(ring, _(color.name));
			}
		}

		_buildLineWidthSlider() {
			this._slider = new Slider(
				(this._lineWidth - LINE_WIDTH_MIN) /
					(LINE_WIDTH_MAX - LINE_WIDTH_MIN),
			);
			this._slider.style = "width: 80px;";
			this._slider.y_align = Clutter.ActorAlign.CENTER;
			this._slider.connect("notify::value", () => {
				this._lineWidth =
					LINE_WIDTH_MIN +
					this._slider.value * (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
				this.emit("line-width-changed", this._lineWidth);
				this._saveCurrentToolEntry();
			});
			this.add_child(this._slider);
		}

		_buildActionButtons() {
			this._undoBtn = new St.Button({
				child: makeIcon("edit-undo-symbolic", this._extensionPath),
				style_class: "screenshot-ui-type-button gradia-square-button",
				reactive: true,
				y_align: Clutter.ActorAlign.CENTER,
			});
			this._undoBtn.connect("clicked", () => this.emit("undo"));
			this.add_child(this._undoBtn);

			attachTooltip(this._undoBtn, _("Undo"));

			this._clearBtn = new St.Button({
				child: makeIcon("user-trash-symbolic", this._extensionPath),
				style_class: "screenshot-ui-type-button gradia-square-button",
				reactive: true,
				y_align: Clutter.ActorAlign.CENTER,
			});
			this._clearBtn.connect("clicked", () => this.emit("clear"));
			this.add_child(this._clearBtn);

			attachTooltip(this._clearBtn, _("Clear all"));
		}

		_addSeparator() {
			this.add_child(
				new St.Widget({
					style_class: "gradia-separator",
					y_expand: true,
				}),
			);
		}

		_onToolClicked(id) {
			const btn = this._toolButtons.find((b) => b._toolId === id);
			if (btn && !btn.reactive) return;

			this._saveCurrentToolEntry();
			this._selectedTool = id;
			for (const btn of this._toolButtons)
				btn.checked = btn._toolId === id;
			this.emit("tool-changed", id);
			this._restoreToolEntry(id);
			this._updateDrawingControlsSensitivity();
		}

		_onColorClicked(hex) {
			this._applyColor(hex);
			this._saveCurrentToolEntry();
		}

		setSelectionToolVisible(enabled) {
			const btn = this._toolButtons.find((b) => b._toolId === "select");
			const iconName = enabled
				? "icons/selection-opaque-3-symbolic.svg"
				: "icons/display-symbolic.svg";
			btn.get_child().gicon = Gio.Icon.new_for_string(
				`${this._extensionPath}/${iconName}`,
			);
			btn._tooltip.text = enabled ? _("Crop") : _("Pick Display");
		}

		scrollLineWidth(direction) {
			if (!this._slider.reactive) return;
			const step = 1 / (LINE_WIDTH_MAX - LINE_WIDTH_MIN);
			if (direction === Clutter.ScrollDirection.UP)
				this._slider.value = Math.min(1, this._slider.value + step);
			else if (direction === Clutter.ScrollDirection.DOWN)
				this._slider.value = Math.max(0, this._slider.value - step);
		}

		get selectedTool() {
			return this._selectedTool;
		}
		get selectedColor() {
			return this._selectedColor;
		}
		get lineWidth() {
			return this._lineWidth;
		}
	},
);
