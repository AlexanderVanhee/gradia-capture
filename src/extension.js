import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { gettext as _, initI18n } from "./i18n.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import Clutter from "gi://Clutter";
import Cairo from "gi://cairo";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import St from "gi://St";

import { Toolbar, TRASH_BUTTON_RADIUS } from "./topBar.js";
import { TOOLS, TOOL_SHORTCUTS } from "./tools.js";
import { GradiaSettings } from "./settings.js";
import { captureAndStoreScreenshot } from "./screenshotStore.js";
import { ResolutionOverlay } from "./resolutionOverlay.js";
import {
	isGradiaFlatpakInstalled,
	createOcrButton,
	createSettingsButton,
	launchGradiaOcrForFile,
	setOcrButtonEnabled,
} from "./gradiaIntegration.js";
import { destroyActiveToast } from "./screenshotToast.js";
import { SelectionClearer } from "./selectionClearer.js";

const MAX_CANVAS_WIDTH = 1920;
const MAX_CANVAS_HEIGHT = 1080;

const MODE_BUTTONS = [
	["_windowButton", "_windowButtonId"],
	["_selectionButton", "_selectionButtonId"],
	["_screenButton", "_screenButtonId"],
	["_castButton", "_castButtonId"],
];

export function setAreaSelectorHandlesVisible(selector, visible) {
	const handles = [
		selector?._topLeftHandle,
		selector?._topRightHandle,
		selector?._bottomLeftHandle,
		selector?._bottomRightHandle,
	].filter((h) => h != null);

	for (const handle of handles) {
		if (visible) handle.show();
		else handle.hide();
	}
}

function getToolDef(id) {
	return TOOLS.find((t) => t.id === id) ?? null;
}

const DrawingCanvas = GObject.registerClass(
	class DrawingCanvas extends St.DrawingArea {
		_init(params) {
			super._init({
				reactive: false,
				x_expand: true,
				y_expand: true,
				...params,
			});

			this._strokes = [];
			this._currentStroke = null;
			this._strokeColor = "#000000";
			this._toolId = "freehand";
			this._strokeWidth = 3;
			this._drawing = false;
			this._dragButton = 0;
			this._dragGrab = null;
			this._stampCounter = 1;
			this._selectedStroke = null;

			this._scaleX = 1;
			this._scaleY = 1;

			this.connect("notify::allocation", () => this._updateScale());
		}

		get strokes() {
			return this._strokes;
		}
		get selectedStroke() {
			return this._selectedStroke;
		}

		setColor(hex) {
			this._strokeColor = hex;
		}
		setTool(id) {
			this._toolId = id;
			if (id !== "drag") this._selectedStroke = null;
		}
		setStrokeWidth(w) {
			this._strokeWidth = w;
		}

		clear() {
			this._strokes = [];
			this._currentStroke = null;
			this._stampCounter = 1;
			this._selectedStroke = null;
			this.queue_repaint();
		}

		undo() {
			if (this._strokes.length > 0) {
				this._strokes.pop();
				this._selectedStroke = null;
				this.queue_repaint();
			}
		}

		hasStrokes() {
			return this._strokes.length > 0;
		}

		deleteSelectedStroke() {
			if (!this._selectedStroke) return false;
			const idx = this._strokes.indexOf(this._selectedStroke);
			if (idx !== -1) this._strokes.splice(idx, 1);
			this._selectedStroke = null;
			this.queue_repaint();
			return true;
		}

		selectStrokeAt(stageX, stageY) {
			for (let i = this._strokes.length - 1; i >= 0; i--) {
				const stroke = this._strokes[i];
				const tool = getToolDef(stroke.toolId);
				if (tool?.hitTest?.(stroke, stageX, stageY)) {
					this._selectedStroke = stroke;
					this.queue_repaint();
					return stroke;
				}
			}
			this._selectedStroke = null;
			this.queue_repaint();
			return null;
		}

		clearSelection() {
			if (this._selectedStroke) {
				this._selectedStroke = null;
				this.queue_repaint();
			}
		}

		moveSelectedStroke(dx, dy) {
			if (!this._selectedStroke) return;
			for (const p of this._selectedStroke.stagePoints) {
				p.x += dx;
				p.y += dy;
			}
			this.queue_repaint();
		}

		adoptStroke(stroke) {
			this._strokes.push(stroke);
			this._selectedStroke = stroke;
			this.queue_repaint();
		}

		evictStroke(stroke) {
			const idx = this._strokes.indexOf(stroke);
			if (idx !== -1) this._strokes.splice(idx, 1);
			if (this._selectedStroke === stroke) this._selectedStroke = null;
			this.queue_repaint();
		}

		_updateScale() {
			const alloc = this.allocation;
			const stageW = alloc.get_width();
			const stageH = alloc.get_height();

			this._scaleX =
				stageW > 0 ? Math.max(1, stageW / MAX_CANVAS_WIDTH) : 1;
			this._scaleY =
				stageH > 0 ? Math.max(1, stageH / MAX_CANVAS_HEIGHT) : 1;
		}

		_stageToLocal(stageX, stageY) {
			const [ok, localX, localY] = this.transform_stage_point(
				stageX,
				stageY,
			);
			if (!ok) return null;
			return { x: localX, y: localY };
		}

		_startDrawing(stageX, stageY) {
			const tool = getToolDef(this._toolId);
			if (!tool?.isDrawing) return;

			const extra = tool.beginStroke?.() ?? {};
			this._currentStroke = {
				color: this._strokeColor,
				toolId: this._toolId,
				strokeWidth: this._strokeWidth,
				stagePoints: [{ x: stageX, y: stageY }],
				...extra,
			};

			if (tool.isStamp) {
				this._currentStroke.counter = this._stampCounter;
				this._finishStamp();
				return;
			}

			this._drawing = true;
			this._dragGrab = global.stage.grab(this);
		}

		_finishStamp() {
			if (this._currentStroke) this._strokes.push(this._currentStroke);
			this._stampCounter++;
			this._currentStroke = null;
			this.queue_repaint();
		}

		_updateDrawing(stageX, stageY) {
			if (!this._drawing) return;

			const tool = getToolDef(this._toolId);

			if (tool?.id === "freehand") {
				this._currentStroke.stagePoints.push({ x: stageX, y: stageY });
			} else {
				if (this._currentStroke.stagePoints.length === 1)
					this._currentStroke.stagePoints.push({
						x: stageX,
						y: stageY,
					});
				else
					this._currentStroke.stagePoints[
						this._currentStroke.stagePoints.length - 1
					] = { x: stageX, y: stageY };
			}

			this.queue_repaint();
		}

		_endDrawing() {
			if (
				this._currentStroke &&
				this._currentStroke.stagePoints.length > 1
			)
				this._strokes.push(this._currentStroke);

			this._currentStroke = null;
			this._drawing = false;
			this._dragButton = 0;

			if (this._dragGrab) {
				this._dragGrab.dismiss();
				this._dragGrab = null;
			}

			this.queue_repaint();
		}

		commitTextStroke(stroke) {
			if (stroke) this._strokes.push(stroke);
			this.queue_repaint();
		}

		vfunc_button_press_event(event) {
			if (this._dragButton) return Clutter.EVENT_PROPAGATE;

			const button = event.get_button();
			if (button !== Clutter.BUTTON_PRIMARY)
				return Clutter.EVENT_PROPAGATE;

			this._dragButton = button;
			const [stageX, stageY] = event.get_coords();
			this._startDrawing(stageX, stageY);
			return Clutter.EVENT_STOP;
		}

		vfunc_button_release_event(event) {
			if (event.get_button() !== this._dragButton)
				return Clutter.EVENT_PROPAGATE;

			this._endDrawing();
			return Clutter.EVENT_STOP;
		}

		vfunc_motion_event(event) {
			if (!this._drawing) return Clutter.EVENT_PROPAGATE;

			const [stageX, stageY] = event.get_coords();
			this._updateDrawing(stageX, stageY);
			return Clutter.EVENT_STOP;
		}

		vfunc_touch_event(event) {
			const eventType = event.type();

			if (eventType === Clutter.EventType.TOUCH_BEGIN) {
				if (this._dragButton) return Clutter.EVENT_PROPAGATE;

				this._dragButton = 1;
				const [stageX, stageY] = event.get_coords();
				this._startDrawing(stageX, stageY);
				return Clutter.EVENT_STOP;
			} else if (eventType === Clutter.EventType.TOUCH_UPDATE) {
				if (!this._drawing) return Clutter.EVENT_PROPAGATE;
				const [stageX, stageY] = event.get_coords();
				this._updateDrawing(stageX, stageY);
				return Clutter.EVENT_STOP;
			} else if (
				eventType === Clutter.EventType.TOUCH_END ||
				eventType === Clutter.EventType.TOUCH_CANCEL
			) {
				if (!this._drawing) return Clutter.EVENT_PROPAGATE;
				this._endDrawing();
				return Clutter.EVENT_STOP;
			}

			return Clutter.EVENT_PROPAGATE;
		}

		vfunc_repaint() {
			const cr = this.get_context();

			const allStrokes = [...this._strokes];
			if (this._currentStroke) allStrokes.push(this._currentStroke);

			let stampCounter = 1;

			for (const stroke of allStrokes) {
				const tool = getToolDef(stroke.toolId);
				if (!tool?.render) continue;

				const localPoints = stroke.stagePoints
					.map((sp) => this._stageToLocal(sp.x, sp.y))
					.filter((p) => p !== null);

				tool.render(
					cr,
					{
						color: stroke.color,
						points: localPoints,
						counter:
							stroke.toolId === "stamp"
								? stampCounter++
								: stroke.counter,
						text: stroke.text,
					},
					stroke.strokeWidth,
				);
			}

			if (this._selectedStroke) {
				const tool = getToolDef(this._selectedStroke.toolId);
				const bounds = tool?.bounds?.(this._selectedStroke);
				if (bounds) {
					const tl = this._stageToLocal(bounds.minX, bounds.minY);
					const br = this._stageToLocal(bounds.maxX, bounds.maxY);
					if (tl && br) {
						cr.setSourceRGBA(1.0, 1.0, 1.0, 0.9);
						cr.setLineWidth(1.5);
						cr.setDash([5, 4], 0);
						cr.rectangle(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
						cr.stroke();
					}
				}
			}
			cr.$dispose();
		}
	},
);

const DrawingInputOverlay = GObject.registerClass(
	class DrawingInputOverlay extends St.Widget {
		_init(canvas, params) {
			super._init({
				reactive: false,
				x_expand: true,
				y_expand: true,
				...params,
			});
			this._canvas = canvas;
		}

		vfunc_button_press_event(event) {
			return this._canvas.vfunc_button_press_event(event);
		}

		vfunc_button_release_event(event) {
			return this._canvas.vfunc_button_release_event(event);
		}

		vfunc_motion_event(event) {
			return this._canvas.vfunc_motion_event(event);
		}

		vfunc_touch_event(event) {
			return this._canvas.vfunc_touch_event(event);
		}
	},
);

export default class GradiaCompanion extends Extension {
	enable() {
		this._originalOpen = Main.screenshotUI.open.bind(Main.screenshotUI);
		this._originalSaveScreenshot = Main.screenshotUI._saveScreenshot.bind(
			Main.screenshotUI,
		);
		this._gradiaSettings = new GradiaSettings(this);
		this._toolbar = null;
		this._canvases = [];
		this._overlays = [];
		this._bins = [];
		this._textEntry = null;
		this._pendingTextStroke = null;

		this._dragToolActive = false;
		this._dragToolStartX = 0;
		this._dragToolStartY = 0;
		this._dragToolCanvas = null;
		this._dragToolGrab = null;
		this._trashButton = null;

		const self = this;
		this._settings = this.getSettings();
		initI18n({
			fallback: this.gettext.bind(this),
			localeDir: `${this.path}/locale`,
			settings: this._settings,
		});

		this._selectionClearer = new SelectionClearer();

		this._panelHidden = false;
		this._panelReactiveStates = null;
		this._lastSelectionMode = false;
		this._selectionDragged = false;

		Main.screenshotUI.open = async function (mode = 0, ...rest) {
			self._portalMode = mode === 2;
			self._selectionDragged = false;
			// Forget any previously remembered selection before the overlay is
			// shown, so the user always has to draw a fresh area themselves.
			if (Main.screenshotUI?._areaSelector)
				self._selectionClearer.patch(Main.screenshotUI._areaSelector);
			const result = await self._originalOpen(mode, ...rest);
			self._ensureUI();
			return result;
		};

		Main.screenshotUI._saveScreenshot = async function () {
			await self._captureScreenshot({ copyOnly: false });
		};

		this._closedId = Main.screenshotUI.connect("closed", () => {
			self._portalMode = false;
			self._removeUI();
		});
	}

	disable() {
		if (this._originalOpen) {
			Main.screenshotUI.open = this._originalOpen;
			this._originalOpen = null;
		}

		if (this._originalSaveScreenshot) {
			Main.screenshotUI._saveScreenshot = this._originalSaveScreenshot;
			this._originalSaveScreenshot = null;
		}

		if (this._closedId) {
			Main.screenshotUI.disconnect(this._closedId);
			this._closedId = null;
		}

		this._gradiaSettings.destroy();
		this._gradiaSettings = null;
		this._settings = null;
		destroyActiveToast();

		this._removeUI();
	}

	_buildWindowComposite(ui) {
		const selectedWindow = ui._windowSelectors
			.flatMap((sel) => sel.windows())
			.find((win) => win.checked);
		if (!selectedWindow) return null;

		const allActors = global.get_window_actors();
		const allUIWindows = ui._windowSelectors.flatMap((sel) =>
			sel.windows(),
		);

		function metaForBoundingBox(bb) {
			for (const actor of allActors) {
				const fr = actor.metaWindow.get_frame_rect();
				if (
					fr.x === bb.x &&
					fr.y === bb.y &&
					fr.width === bb.width &&
					fr.height === bb.height
				)
					return actor.metaWindow;
			}
			return null;
		}

		function entryForMeta(meta) {
			const fr = meta.get_frame_rect();
			const br = meta.get_buffer_rect();
			const uiWin = allUIWindows.find(
				(w) =>
					w.boundingBox.x === fr.x &&
					w.boundingBox.y === fr.y &&
					w.boundingBox.width === fr.width &&
					w.boundingBox.height === fr.height,
			);
			if (uiWin) {
				const c = uiWin.windowContent;
				if (!c) return null;
				return {
					texture: c.get_texture(),
					scale: uiWin.bufferScale,
					rect: {
						x: br.x,
						y: br.y,
						width: br.width,
						height: br.height,
					},
				};
			}
			const actor = allActors.find((a) => {
				const afr = a.metaWindow.get_frame_rect();
				return (
					afr.x === fr.x &&
					afr.y === fr.y &&
					afr.width === fr.width &&
					afr.height === fr.height
				);
			});
			if (!actor) return null;
			const content = actor.paint_to_content(null);
			if (!content) return null;
			return {
				texture: content.get_texture(),
				scale: actor.get_resource_scale(),
				rect: { x: br.x, y: br.y, width: br.width, height: br.height },
			};
		}

		const selectedMeta = metaForBoundingBox(selectedWindow.boundingBox);
		const chain = [];
		if (selectedMeta) {
			let cur = selectedMeta.get_transient_for();
			while (cur) {
				chain.push(cur);
				cur = cur.get_transient_for();
			}
		}

		const selContent = selectedWindow.windowContent;
		if (!selContent) return null;

		const selBr =
			selectedMeta?.get_buffer_rect() ?? selectedWindow.boundingBox;

		const entries = [
			{
				texture: selContent.get_texture(),
				scale: selectedWindow.bufferScale,
				rect: {
					x: selBr.x,
					y: selBr.y,
					width: selBr.width,
					height: selBr.height,
				},
			},
			...chain.map(entryForMeta).filter((e) => e !== null),
		];

		return { windows: entries };
	}

	async _captureScreenshot({
		copyOnly = false,
		ocr = false,
		externalSave = false,
	} = {}) {
		const ui = Main.screenshotUI;
		this._commitTextEntry();
		if (ocr) copyOnly = false;

		if (
			!ui._selectionButton.checked &&
			!ui._screenButton.checked &&
			!ui._windowButton.checked
		)
			return;

		if (ui._selectionButton.checked) {
			const [, , w, h] = ui._areaSelector.getGeometry?.() ?? [0, 0, 0, 0];
			if (w <= 2 || h <= 2) return;
		}

		const shouldCopy = !ocr && !externalSave;
		const shouldSave = !copyOnly && !externalSave;
		const format =
			this._portalMode || ocr
				? "png"
				: this._settings.get_string("screenshot-format");
		const playSound = this._settings.get_boolean("play-sound");

		const _capture = (
			texture,
			geometry,
			scale,
			cursor,
			compositeFn,
			windowComposite = null,
		) => {
			const capturePromise = captureAndStoreScreenshot(
				texture,
				geometry,
				scale,
				cursor,
				compositeFn,
				windowComposite,
				{
					copy: shouldCopy,
					save: shouldSave,
					externalSave,
					format,
					playSound,
				},
			);
			// We have to await in portal mode to prevent a race condition where
			// the overlay gets closed before 'screenshot-taken' gets emitted, so the portal doesn't fail.
			// GNOME Shell does the same, but we only await conditionally.
			if (this._portalMode || ocr) return capturePromise;
			return true;
		};

		if (ui._windowButton.checked) {
			const selectedWindow = ui._windowSelectors
				.flatMap((sel) => sel.windows())
				.find((win) => win.checked);
			if (!selectedWindow) return;

			let cursorTexture = selectedWindow
				.getCursorTexture()
				?.get_texture();
			if (!ui._cursor.visible) cursorTexture = null;

			if (this._settings.get_boolean("composite-window-capture")) {
				const windowComposite = this._buildWindowComposite(ui);
				if (!windowComposite) return;

				windowComposite.cursor = {
					texture: cursorTexture ?? null,
					x:
						selectedWindow.cursorPoint.x +
						selectedWindow.boundingBox.x,
					y:
						selectedWindow.cursorPoint.y +
						selectedWindow.boundingBox.y,
					scale: ui._cursorScale,
				};
				return await _capture(
					null,
					null,
					1,
					null,
					null,
					windowComposite,
				);
			}

			const content = selectedWindow.windowContent;
			if (!content) return;

			return await _capture(
				content.get_texture(),
				null,
				selectedWindow.bufferScale,
				{
					texture: cursorTexture ?? null,
					x:
						selectedWindow.cursorPoint.x *
						selectedWindow.bufferScale,
					y:
						selectedWindow.cursorPoint.y *
						selectedWindow.bufferScale,
					scale: ui._cursorScale,
				},
				null,
			);
		}

		const content = ui._stageScreenshot.get_content();
		if (!content) return;

		let cursorTexture = ui._cursor.content?.get_texture();
		if (!ui._cursor.visible) cursorTexture = null;

		const hasStrokes = this._canvases.some((c) => c.hasStrokes());
		const strokeData = hasStrokes ? this._buildStrokeData() : null;

		return await _capture(
			content.get_texture(),
			ui._getSelectedGeometry(true),
			ui._scale,
			{
				texture: cursorTexture ?? null,
				x: ui._cursor.x * ui._scale,
				y: ui._cursor.y * ui._scale,
				scale: ui._cursorScale,
			},
			strokeData
				? (bytes, pixbuf) =>
						this._compositeStrokesOntoPixbuf(
							bytes,
							pixbuf,
							strokeData,
						)
				: null,
		);
	}

	_binContainsStagePoint(bin, stageX, stageY) {
		const [ok, lx, ly] = bin.transform_stage_point(stageX, stageY);
		if (!ok) return false;
		const alloc = bin.allocation;
		return (
			lx >= 0 &&
			lx < alloc.get_width() &&
			ly >= 0 &&
			ly < alloc.get_height()
		);
	}

	_canvasForStagePoint(stageX, stageY) {
		for (let i = 0; i < this._bins.length; i++) {
			if (this._binContainsStagePoint(this._bins[i], stageX, stageY))
				return this._canvases[i];
		}
		return this._canvases[0] ?? null;
	}

	_getSelectedCanvasAndStroke() {
		for (const canvas of this._canvases) {
			if (canvas.selectedStroke)
				return { canvas, stroke: canvas.selectedStroke };
		}
		return null;
	}

	_clearAllSelections(exceptCanvas = null) {
		for (const canvas of this._canvases) {
			if (canvas !== exceptCanvas) canvas.clearSelection();
		}
	}

	_updateTrashButton() {
		const sel = this._getSelectedCanvasAndStroke();
		if (!sel) {
			this._hideTrashButton();
			return;
		}

		const tool = getToolDef(sel.stroke.toolId);
		const bounds = tool?.bounds?.(sel.stroke);
		if (!bounds) {
			this._hideTrashButton();
			return;
		}

		const primaryBin = Main.screenshotUI._primaryMonitorBin;
		if (!primaryBin) return;

		const [okTR, localTRX, localTRY] = primaryBin.transform_stage_point(
			bounds.maxX,
			bounds.minY,
		);
		if (!okTR) {
			this._hideTrashButton();
			return;
		}

		if (!this._trashButton) {
			this._trashButton = new St.Button({
				style_class: "gradia-selection-trash gradia-circle-button",
				child: new St.Icon({
					icon_name: "user-trash-symbolic",
					style: "icon-size: 16px;",
				}),
				reactive: true,
			});
			this._trashButton.connect("clicked", () => {
				const s = this._getSelectedCanvasAndStroke();
				if (s) {
					s.canvas.deleteSelectedStroke();
					this._hideTrashButton();
				}
			});
			primaryBin.insert_child_below(
				this._trashButton,
				Main.screenshotUI._panel,
			);
		}

		const btnX = Math.round(localTRX - TRASH_BUTTON_RADIUS);
		const btnY = Math.round(localTRY - TRASH_BUTTON_RADIUS);
		this._trashButton.set_position(btnX, btnY);
		this._trashButton.show();
	}

	_hideTrashButton() {
		this._trashButton?.hide();
	}

	_destroyTrashButton() {
		if (this._trashButton) {
			this._trashButton.destroy();
			this._trashButton = null;
		}
	}

	_onDragToolPress(stageX, stageY) {
		for (let i = this._canvases.length - 1; i >= 0; i--) {
			const stroke = this._canvases[i].selectStrokeAt(stageX, stageY);
			if (stroke) {
				this._clearAllSelections(this._canvases[i]);
				this._updateTrashButton();
				this._toolbar._syncToStroke(stroke);
				this._toolbar._updateDrawingControlsSensitivity();

				this._dragToolActive = true;
				this._dragToolStartX = stageX;
				this._dragToolStartY = stageY;
				this._dragToolCanvas = this._canvases[i];
				this._dragToolGrab = global.stage.grab(
					this._overlays[i] ?? this._overlays[0],
				);
				return;
			}
		}

		this._clearAllSelections();
		this._hideTrashButton();
		this._dragToolActive = false;
	}

	_onDragToolMotion(stageX, stageY) {
		if (!this._dragToolActive || !this._dragToolCanvas) return;

		const dx = stageX - this._dragToolStartX;
		const dy = stageY - this._dragToolStartY;

		const stroke = this._dragToolCanvas.selectedStroke;
		const targetCanvas = this._canvasForStagePoint(stageX, stageY);

		if (targetCanvas && targetCanvas !== this._dragToolCanvas && stroke) {
			this._dragToolCanvas.evictStroke(stroke);
			targetCanvas.adoptStroke(stroke);
			this._dragToolCanvas = targetCanvas;
		}

		this._dragToolCanvas.moveSelectedStroke(dx, dy);
		this._dragToolStartX = stageX;
		this._dragToolStartY = stageY;
		this._updateTrashButton();
	}

	_onDragToolRelease() {
		this._dragToolActive = false;
		this._dragToolCanvas = null;

		if (this._dragToolGrab) {
			this._dragToolGrab.dismiss();
			this._dragToolGrab = null;
		}

		this._updateTrashButton();
		this._toolbar._updateDrawingControlsSensitivity();
	}

	_compositeStrokesOntoPixbuf(bytes, pixbuf, data) {
		const { selX, selY, selW, selH, strokes, stageScale } = data;
		if (selW <= 0 || selH <= 0) return null;

		const imgWidth = pixbuf.get_width();
		const imgHeight = pixbuf.get_height();
		const scaleX = imgWidth / selW;
		const scaleY = imgHeight / selH;

		const surface = new Cairo.ImageSurface(
			Cairo.Format.ARGB32,
			imgWidth,
			imgHeight,
		);
		const cr = new Cairo.Context(surface);
		imports.gi.Gdk.cairo_set_source_pixbuf(cr, pixbuf, 0, 0);
		cr.paint();

		for (const stroke of strokes) {
			const tool = getToolDef(stroke.toolId);
			if (!tool?.render) continue;

			const converted = stroke.stagePoints.map((p) => ({
				x: (p.x / stageScale - selX) * scaleX,
				y: (p.y / stageScale - selY) * scaleY,
			}));

			const lw = stroke.strokeWidth * ((scaleX + scaleY) / 2);

			tool.render(
				cr,
				{
					color: stroke.color,
					points: converted,
					counter: stroke.counter,
					text: stroke.text,
				},
				lw,
			);
		}

		cr.$dispose();

		const newPixbuf = imports.gi.Gdk.pixbuf_get_from_surface(
			surface,
			0,
			0,
			imgWidth,
			imgHeight,
		);
		if (!newPixbuf) return null;

		return { pixbuf: newPixbuf };
	}

	_updateTextEntryStyle() {
		if (!this._textEntry) return;
		const fs = Math.max(8, Math.round(this._toolbar.lineWidth * 3));
		const col = this._toolbar.selectedColor;
		this._textEntry.style = `
            color: ${col};
            caret-color: ${col};
            font-size: ${fs}px;
            font-family: "Sans";
        `;
	}

	_spawnTextEntry(stageX, stageY) {
		if (this._textEntry) {
			this._commitTextEntry();
			return;
		}

		const ui = Main.screenshotUI;
		const primaryBin = ui._primaryMonitorBin;
		if (!primaryBin) return;

		const [ok, localX, localY] = primaryBin.transform_stage_point(
			stageX,
			stageY,
		);
		if (!ok) return;

		this._textTargetCanvas = this._canvasForStagePoint(stageX, stageY);

		this._pendingTextStroke = {
			color: this._toolbar.selectedColor,
			toolId: "text",
			strokeWidth: this._toolbar.lineWidth,
			stagePoints: [{ x: stageX, y: stageY }],
			text: "",
		};

		const entry = new St.Entry({
			style_class: "gradia-text-entry",
			reactive: true,
			can_focus: true,
		});

		entry.set_x_expand(false);
		primaryBin.add_child(entry);
		this._textEntry = entry;
		this._updateTextEntryStyle();

		const allocId = entry.connect("notify::allocation", () => {
			entry.disconnect(allocId);

			const node = entry.get_theme_node();
			const paddingTop = node.get_padding(St.Side.TOP);
			const paddingLeft = node.get_padding(St.Side.LEFT);

			entry.set_position(
				Math.round(localX - paddingLeft),
				Math.round(localY - paddingTop),
			);
		});

		const clutterText = entry.get_clutter_text();

		clutterText.connect("text-changed", () => {
			const fs = Math.max(8, Math.round(this._toolbar.lineWidth * 3));
			const [, naturalWidth] = clutterText.get_preferred_width(-1);
			entry.set_width(Math.max(fs * 4, naturalWidth + fs));
		});

		clutterText.connect("key-press-event", (_actor, event) => {
			const sym = event.get_key_symbol();
			if (sym === Clutter.KEY_Return || sym === Clutter.KEY_KP_Enter)
				return (this._commitTextEntry(), Clutter.EVENT_STOP);
			if (sym === Clutter.KEY_Escape)
				return (this._cancelTextEntry(), Clutter.EVENT_STOP);
			return Clutter.EVENT_PROPAGATE;
		});

		this._committingText = false;
		clutterText.connect("notify::has-key-focus", () => {
			if (!clutterText.has_key_focus() && !this._committingText)
				this._commitTextEntry();
		});

		entry.grab_key_focus();
	}

	_teardownTextEntry() {
		this._committingText = true;
		this._textEntry.destroy();
		this._textEntry = null;
		this._pendingTextStroke = null;
		this._textTargetCanvas = null;

		if (this._idleSourceId) GLib.source_remove(this._idleSourceId);

		this._idleSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
			this._idleSourceId = 0;
			this._committingText = false;
			Main.screenshotUI.grab_key_focus();
			return GLib.SOURCE_REMOVE;
		});
	}

	_commitTextEntry() {
		if (!this._textEntry) return;

		const text = this._textEntry.get_text()?.trim() ?? "";
		if (text.length > 0 && this._pendingTextStroke) {
			this._pendingTextStroke.text = text;
			this._textTargetCanvas?.commitTextStroke(this._pendingTextStroke);
		}

		this._teardownTextEntry();
	}

	_cancelTextEntry() {
		if (!this._textEntry) return;

		this._teardownTextEntry();
	}

	_buildStrokeData() {
		const ui = Main.screenshotUI;

		let selX = 0,
			selY = 0,
			selW = 0,
			selH = 0;

		if (ui._selectionButton.checked) {
			[selX, selY, selW, selH] = ui._areaSelector.getGeometry();
		} else if (ui._screenButton.checked) {
			const index = ui._screenSelectors.findIndex((s) => s.checked);
			const monitor = Main.layoutManager.monitors[index];
			selX = monitor.x;
			selY = monitor.y;
			selW = monitor.width;
			selH = monitor.height;
		} else if (ui._windowButton.checked) {
			const window = ui._windowSelectors
				.flatMap((sel) => sel.windows())
				.find((win) => win.checked);

			if (window) {
				const box = window.boundingBox;
				selX = box.x;
				selY = box.y;
				selW = box.width;
				selH = box.height;
			}
		}

		const strokes = this._canvases.flatMap((c) =>
			c.strokes.map((s) => ({
				color: s.color,
				toolId: s.toolId,
				counter: s.counter,
				strokeWidth: s.strokeWidth,
				text: s.text,
				stagePoints: s.stagePoints.map((p) => ({ x: p.x, y: p.y })),
			})),
		);

		return {
			selX,
			selY,
			selW,
			selH,
			strokes,
			stageScale: global.stage.scale_factor || 1,
		};
	}

	_isDrawingTool(id) {
		return getToolDef(id)?.isDrawing ?? false;
	}

	_setTool(id) {
		if (id !== "text") this._commitTextEntry();

		if (id !== "drag") {
			this._clearAllSelections();
			this._hideTrashButton();
		}

		// 回到裁剪工具时，重新显示"拖动以选择区域"的提示
		if (id === "select") this._selectionDragged = false;

		const drawing = this._isDrawingTool(id);
		const dragging = id === "drag";

		for (const canvas of this._canvases) canvas.setTool(id);

		for (const overlay of this._overlays)
			overlay.reactive = drawing || dragging;

		this._updateSelectionHint();
		this._updateAreaSelectorState(id);
		this._updatePanelAutoHide();
	}

	_updateSelectionHint() {
		if (!this._selectionHintLabel) return;

		const selectionMode =
			Main.screenshotUI?._selectionButton?.checked ?? false;
		const recordingMode = this._isRecordingMode();
		const tool = this._toolbar?.selectedTool ?? "select";
		const show =
			selectionMode &&
			!recordingMode &&
			tool === "select" &&
			!this._selectionDragged;

		if (show) {
			this._selectionHintLabel.remove_all_transitions();
			this._selectionHintLabel.set({ visible: true, opacity: 255 });
		} else {
			this._selectionHintLabel.hide();
		}
	}

	_updateAreaSelectorState(id) {
		const selector = Main.screenshotUI?._areaSelector;
		if (!selector) return;

		if (!Main.screenshotUI._selectionButton.checked) return;

		const drawing = this._isDrawingTool(id);
		const dragging = id === "drag";

		if (drawing || dragging) {
			selector.reactive = false;
			setAreaSelectorHandlesVisible(selector, false);
		} else {
			selector.reactive = true;
			selector._areaIndicator?.show();
			setAreaSelectorHandlesVisible(selector, true);
		}
	}

	_isWindowMode() {
		return Main.screenshotUI._windowButton.checked;
	}

	_isRecordingMode() {
		return Main.screenshotUI._castButton?.checked ?? false;
	}

	_updateVisibilityForMode() {
		const windowMode = this._isWindowMode();
		const selectionMode =
			Main.screenshotUI._selectionButton?.checked ?? false;
		const recordingMode = this._isRecordingMode();
		const screenMode = Main.screenshotUI._screenButton?.checked ?? false;
		const show = !windowMode && !recordingMode;

		if (this._toolbar) {
			this._toolbar.visible = show;
			this._toolbar.setSelectionToolVisible(!screenMode);
		}

		for (const canvas of this._canvases) canvas.opacity = show ? 255 : 0;

		for (const overlay of this._overlays) {
			overlay.opacity = show ? 255 : 0;
			if (!show) overlay.reactive = false;
		}

		if (!show) {
			this._hideTrashButton();
		} else {
			this._updateAreaSelectorState(
				this._toolbar?.selectedTool ?? "select",
			);
			this._setTool(this._toolbar?.selectedTool ?? "select");
		}

		setOcrButtonEnabled(
			this._ocrButton,
			!windowMode && !recordingMode && !screenMode && !this._portalMode,
		);

		this._updateSelectionHint();

		if (selectionMode && !this._lastSelectionMode) {
			// Re-entering selection mode: drop any stale area so the user
			// always starts from a blank slate.
			const selector = Main.screenshotUI?._areaSelector;
			if (selector) this._selectionClearer.clear(selector);
		}
		this._lastSelectionMode = selectionMode;

		this._updatePanelAutoHide();
	}

	_connectDragOpacity() {
		const selector = Main.screenshotUI?._areaSelector;
		if (!selector) return;

		this._dragStartedId = selector.connect("drag-started", () => {
			this._toolbar?.ease({
				opacity: 100,
				duration: 200,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			});
			this._resolutionOverlay?.onDragStarted();

			// Keep the bottom panel hidden while redrawing the selection.
			if (this._panelHidden) this._setPanelOpacity(0, 120);
		});

		this._dragEndedId = selector.connect("drag-ended", () => {
			this._toolbar?.ease({
				opacity: 255,
				duration: 200,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			});
			this._resolutionOverlay?.onDragEnded();
			this._updatePanelAutoHide();
		});
	}

	_disconnectDragOpacity() {
		const selector = Main.screenshotUI?._areaSelector;
		if (!selector) return;

		for (const id of ["_dragStartedId", "_dragEndedId"]) {
			if (this[id]) {
				selector.disconnect(this[id]);
				this[id] = null;
			}
		}
	}

	_setPanelOpacity(opacity, duration = 150) {
		const panel = Main.screenshotUI?._panel;
		if (!panel) return;
		panel.remove_all_transitions();
		panel.ease({
			opacity,
			duration,
			mode: Clutter.AnimationMode.EASE_OUT_QUAD,
		});
	}

	// Clutter 的 should_pick 只会检查 actor 自身的 reactive 标志，而不会递归到
	// 父级：仅把 _panel.reactive 设为 false 并不会让里面的按钮失效，鼠标仍会
	// 触发 hover（tooltip）与点击。因此隐藏面板时要递归禁用整个子树的 reactive，
	// 并在显示时恢复成隐藏前的状态（这样既保留淡出动画，又彻底切断交互）。
	_setPanelInteractive(interactive) {
		const panel = Main.screenshotUI?._panel;
		if (!panel) return;

		if (!interactive) {
			if (this._panelReactiveStates) return;
			const states = new Map();
			const walk = (actor) => {
				states.set(actor, actor.reactive);
				actor.reactive = false;
				for (const child of actor.get_children()) walk(child);
			};
			walk(panel);
			this._panelReactiveStates = states;
		} else {
			const states = this._panelReactiveStates;
			if (!states) return;
			for (const [actor, wasReactive] of states)
				actor.reactive = wasReactive;
			this._panelReactiveStates = null;
		}
	}

	_panelShouldHide() {
		if (this._isRecordingMode()) return false;
		if (!Main.screenshotUI?._selectionButton?.checked) return false;
		const tool = this._toolbar?.selectedTool ?? "select";
		return this._isDrawingTool(tool);
	}

	_updatePanelAutoHide() {
		if (this._panelShouldHide()) this._hideBottomPanel();
		else this._showBottomPanel();
	}

	_hideBottomPanel() {
		const panel = Main.screenshotUI?._panel;
		if (!panel) return;
		this._panelHidden = true;
		this._setPanelInteractive(false);
		this._setPanelOpacity(0, 120);

		const closeBtn = Main.screenshotUI?._closeButton;
		if (closeBtn) {
			closeBtn.reactive = false;
			closeBtn.remove_all_transitions();
			closeBtn.ease({
				opacity: 0,
				duration: 120,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			});
		}
	}

	_showBottomPanel() {
		const panel = Main.screenshotUI?._panel;
		if (!panel) return;
		this._panelHidden = false;
		this._setPanelInteractive(true);
		this._setPanelOpacity(255, 150);

		const closeBtn = Main.screenshotUI?._closeButton;
		if (closeBtn) {
			closeBtn.reactive = true;
			closeBtn.remove_all_transitions();
			closeBtn.ease({
				opacity: 255,
				duration: 150,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
			});
		}
	}

	_ensureUI() {
		if (this._toolbar) return;

		const ui = Main.screenshotUI;

		this._canvases = [];
		this._overlays = [];
		this._bins = [];

		const monitorBins = ui._monitorBins ?? [];
		const binsToUse =
			monitorBins.length > 0
				? monitorBins
				: ui._primaryMonitorBin
					? [ui._primaryMonitorBin]
					: [];

		for (const bin of binsToUse) {
			this._bins.push(bin);

			const canvas = new DrawingCanvas({
				style: "background-color: transparent;",
			});
			canvas.add_constraint(
				new Clutter.BindConstraint({
					source: bin,
					coordinate: Clutter.BindCoordinate.ALL,
				}),
			);
			ui.insert_child_below(canvas, ui._areaSelector);
			this._canvases.push(canvas);

			const overlay = new DrawingInputOverlay(canvas, {
				style: "background-color: transparent;",
			});

			overlay.connect("button-press-event", (_actor, event) => {
				const tool = this._toolbar?.selectedTool;

				if (tool === "text") {
					const [stageX, stageY] = event.get_coords();
					this._spawnTextEntry(stageX, stageY);
					return Clutter.EVENT_STOP;
				}

				if (tool === "drag") {
					const [stageX, stageY] = event.get_coords();
					this._onDragToolPress(stageX, stageY);
					return Clutter.EVENT_STOP;
				}

				return Clutter.EVENT_PROPAGATE;
			});

			overlay.connect("motion-event", (_actor, event) => {
				if (this._toolbar?.selectedTool === "drag") {
					const [stageX, stageY] = event.get_coords();
					this._onDragToolMotion(stageX, stageY);
					return Clutter.EVENT_STOP;
				}
				return Clutter.EVENT_PROPAGATE;
			});

			overlay.connect("button-release-event", () => {
				if (this._toolbar?.selectedTool === "drag") {
					this._onDragToolRelease();
					return Clutter.EVENT_STOP;
				}
				return Clutter.EVENT_PROPAGATE;
			});

			bin.add_child(overlay);
			this._overlays.push(overlay);
		}

		const primaryBin = ui._primaryMonitorBin;
		if (!primaryBin) return;

		this._toolbar = new Toolbar({
			extensionPath: this.path,
			gradiaSettings: this._gradiaSettings,
		});

		this._toolbar.connect("tool-changed", (_toolbar, id) => {
			this._setTool(id);
		});

		this._toolbar.connect("color-changed", (_toolbar, hex) => {
			for (const canvas of this._canvases) canvas.setColor(hex);

			const sel = this._getSelectedCanvasAndStroke();
			if (sel) {
				sel.stroke.color = hex;
				sel.canvas.queue_repaint();
			}

			if (this._pendingTextStroke) {
				this._pendingTextStroke.color = hex;
				this._updateTextEntryStyle();
			}
		});

		this._toolbar.connect("line-width-changed", (_toolbar, width) => {
			for (const canvas of this._canvases) canvas.setStrokeWidth(width);

			const sel = this._getSelectedCanvasAndStroke();
			if (sel) {
				sel.stroke.strokeWidth = width;
				sel.canvas.queue_repaint();
				this._updateTrashButton();
			}

			if (this._pendingTextStroke) {
				this._pendingTextStroke.strokeWidth = width;
				this._updateTextEntryStyle();
			}
		});

		this._toolbar._hasSelection = () =>
			!!this._getSelectedCanvasAndStroke();

		this._toolbar.connect("undo", () => {
			if (this._textEntry) {
				this._cancelTextEntry();
				return;
			}
			if (this._toolbar.selectedTool === "drag") {
				const sel = this._getSelectedCanvasAndStroke();
				if (sel) {
					sel.canvas.deleteSelectedStroke();
					this._hideTrashButton();
					return;
				}
			}
			for (let i = this._canvases.length - 1; i >= 0; i--) {
				if (this._canvases[i].hasStrokes()) {
					this._canvases[i].undo();
					break;
				}
			}
		});

		this._toolbar.connect("clear", () => {
			this._cancelTextEntry();
			this._clearAllSelections();
			this._hideTrashButton();
			for (const canvas of this._canvases) canvas.clear();
		});

		if (isGradiaFlatpakInstalled()) {
			const ui = Main.screenshotUI;
			this._ocrButton = createOcrButton(async () => {
				const file = await this._captureScreenshot({ ocr: true });
				Main.screenshotUI.close();
				launchGradiaOcrForFile(file);
			});
			ui._showPointerButtonContainer.insert_child_below(
				this._ocrButton,
				ui._showPointerButton,
			);
		}

		this._settingsButton = createSettingsButton(() => {
			Main.screenshotUI.close();
			this.openPreferences();
		});
		ui._showPointerButtonContainer.insert_child_below(
			this._settingsButton,
			ui._showPointerButton,
		);

		for (const canvas of this._canvases) {
			canvas.setColor(this._toolbar.selectedColor);
			canvas.setTool(this._toolbar.selectedTool);
			canvas.setStrokeWidth(this._toolbar.lineWidth);
		}

		primaryBin.add_child(this._toolbar);

		this._resolutionOverlay = new ResolutionOverlay(primaryBin);

		this._keyPressId = Main.screenshotUI.connect(
			"key-press-event",
			(_actor, event) => {
				const sym = event.get_key_symbol();
				const mods = event.get_state();
				const ctrl = mods & Clutter.ModifierType.CONTROL_MASK;

				if (ctrl && sym === Clutter.KEY_z) {
					this._toolbar.emit("undo");
					return Clutter.EVENT_STOP;
				}

				if (ctrl && sym === Clutter.KEY_c) {
					if (!this._isRecordingMode() && !this._portalMode) {
						this._captureScreenshot({ copyOnly: true }).then(
							(result) => {
								if (result !== undefined)
									Main.screenshotUI.close();
							},
						);
						return Clutter.EVENT_STOP;
					}
				}

				if (ctrl && sym === Clutter.KEY_s) {
					if (!this._isRecordingMode()) {
						this._captureScreenshot({ externalSave: true }).then(
							(result) => {
								if (result !== undefined)
									Main.screenshotUI.close();
							},
						);
						return Clutter.EVENT_STOP;
					}
				}

				if (ctrl && sym === Clutter.KEY_e) {
					this._ocrButton?.emit("clicked", 0);
					return Clutter.EVENT_STOP;
				}

				if (
					this._toolbar?.selectedTool === "drag" &&
					(sym === Clutter.KEY_Delete ||
						sym === Clutter.KEY_BackSpace)
				) {
					const sel = this._getSelectedCanvasAndStroke();
					if (sel) {
						sel.canvas.deleteSelectedStroke();
						this._hideTrashButton();
						return Clutter.EVENT_STOP;
					}
				}

				if (!ctrl && sym in TOOL_SHORTCUTS) {
					this._toolbar._onToolClicked(TOOL_SHORTCUTS[sym]);
					return Clutter.EVENT_STOP;
				}

				return Clutter.EVENT_PROPAGATE;
			},
		);

		for (const [prop, id] of MODE_BUTTONS) {
			this[id] = ui[prop].connect("notify::checked", () =>
				this._updateVisibilityForMode(),
			);
		}

		this._selectionHintLabel = new St.Label({
			text: _("Drag to Make a Selection"),
			style_class: "screenshot-ui-panel gradia-hint-label",
			x_align: Clutter.ActorAlign.CENTER,
			y_align: Clutter.ActorAlign.CENTER,
			x_expand: true,
			y_expand: true,
		});
		primaryBin.add_child(this._selectionHintLabel);

		this._hideLabelId = ui._areaSelector.connect("drag-started", () => {
			this._selectionDragged = true;
			this._selectionHintLabel?.ease({
				opacity: 0,
				duration: 200,
				mode: Clutter.AnimationMode.EASE_OUT_QUAD,
				onComplete: () => this._selectionHintLabel?.hide(),
			});
		});

		this._connectDragOpacity();

		this._scrollId = Main.screenshotUI.connect(
			"scroll-event",
			(_actor, event) => {
				this._toolbar.scrollLineWidth(event.get_scroll_direction());
				return Clutter.EVENT_PROPAGATE;
			},
		);

		this._setTool("select");
		this._updateVisibilityForMode();
	}

	_removeUI() {
		this._cancelTextEntry();
		this._destroyTrashButton();

		// 先恢复面板子树的交互状态，避免下面销毁 ocr/settings 按钮后再去
		// 访问已销毁的 actor。
		this._setPanelInteractive(true);

		if (this._idleSourceId) {
			GLib.source_remove(this._idleSourceId);
			this._idleSourceId = 0;
		}

		if (this._ocrButton) {
			this._ocrButton.destroy();
			this._ocrButton = null;
		}

		if (this._settingsButton) {
			this._settingsButton.destroy();
			this._settingsButton = null;
		}

		if (this._dragToolGrab) {
			this._dragToolGrab.dismiss();
			this._dragToolGrab = null;
		}

		const ui = Main.screenshotUI;

		if (this._keyPressId) {
			Main.screenshotUI.disconnect(this._keyPressId);
			this._keyPressId = null;
		}

		for (const [prop, id] of MODE_BUTTONS) {
			if (this[id]) {
				ui[prop].disconnect(this[id]);
				this[id] = null;
			}
		}

		this._disconnectDragOpacity();

		if (this._hideLabelId) {
			const areaSelector = ui._areaSelector;
			if (areaSelector) areaSelector.disconnect(this._hideLabelId);
			this._hideLabelId = null;
		}

		this._selectionClearer.restore();

		const selector = ui._areaSelector;
		if (selector) {
			selector.reactive = true;
			setAreaSelectorHandlesVisible(selector, true);
		}

		for (const overlay of this._overlays) overlay.destroy();
		this._overlays = [];

		for (const canvas of this._canvases) canvas.destroy();
		this._canvases = [];
		this._bins = [];

		if (this._selectionHintLabel) {
			this._selectionHintLabel.destroy();
			this._selectionHintLabel = null;
		}

		if (this._toolbar) {
			this._toolbar.destroy();
			this._toolbar = null;
		}

		if (this._scrollId) {
			Main.screenshotUI.disconnect(this._scrollId);
			this._scrollId = null;
		}

		this._panelHidden = false;
		this._lastSelectionMode = false;

		const panel = ui._panel;
		if (panel) {
			panel.reactive = true;
			panel.remove_all_transitions();
			panel.show();
			panel.opacity = 255;
		}

		const closeBtn = ui._closeButton;
		if (closeBtn) {
			closeBtn.reactive = true;
			closeBtn.remove_all_transitions();
			closeBtn.opacity = 255;
		}

		if (this._resolutionOverlay) {
			this._resolutionOverlay.destroy();
			this._resolutionOverlay = null;
		}
	}
}
