/* Adapted from https://github.com/abdallah-alkanani/no-screenshot-box/blob/main/extension.js */

import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";

const HANDLE_NAMES = [
	"_topLeftHandle",
	"_topRightHandle",
	"_bottomLeftHandle",
	"_bottomRightHandle",
];

export class SelectionClearer {
	constructor() {
		this._injectionManager = null;
		this._indicatorOpacity = null;
		this._handleOpacities = null;
		this._dragStartedId = null;
		this._selector = null;
	}

	patch(selector) {
		this.restore();
		this._selector = selector;
		this._injectionManager = new InjectionManager();
		this._indicatorOpacity = null;
		this._handleOpacities = new Map();

		if (selector.reset) {
			this._injectionManager.overrideMethod(
				selector,
				"reset",
				(originalReset) =>
					(...args) => {
						const result = originalReset.apply(selector, args);
						this._clearSelection(selector);
						return result;
					},
			);
		}

		this._dragStartedId = selector.connect("drag-started", () =>
			this._revealSelection(selector),
		);
		this._clearSelection(selector);
	}

	restore() {
		this._injectionManager?.clear();
		this._injectionManager = null;

		const selector = this._selector;
		this._selector = null;

		if (!selector) return;

		if (this._dragStartedId) {
			selector.disconnect(this._dragStartedId);
			this._dragStartedId = null;
		}

		const indicator = selector._areaIndicator;
		if (indicator && this._indicatorOpacity !== null)
			indicator.opacity = this._indicatorOpacity;
		this._indicatorOpacity = null;

		for (const name of HANDLE_NAMES) {
			const actor = selector[name];
			const original = this._handleOpacities?.get(name);
			if (actor && original !== undefined) actor.opacity = original;
		}
		this._handleOpacities = null;
	}

	/** Forget the pre-selected area, used when (re-)entering selection mode. */
	clear(selector) {
		this._clearSelection(selector);
	}

	_clearSelection(selector) {
		for (const coord of ["_startX", "_startY", "_lastX", "_lastY"]) {
			if (coord in selector) selector[coord] = 0;
		}
		selector._updateSelectionRect?.();

		for (const name of HANDLE_NAMES) {
			const actor = selector[name];
			if (!actor) continue;
			if (!this._handleOpacities.has(name))
				this._handleOpacities.set(name, actor.opacity);
			actor.opacity = 0;
		}

		// Hide the whole area indicator (selection border plus the outer
		// shade) so the screen is not dimmed while nothing is selected yet.
		const indicator = selector._areaIndicator;
		if (indicator) {
			if (this._indicatorOpacity === null)
				this._indicatorOpacity = indicator.opacity;
			indicator.opacity = 0;
		}
	}

	_revealSelection(selector) {
		const indicator = selector._areaIndicator;
		if (indicator && this._indicatorOpacity !== null)
			indicator.opacity = this._indicatorOpacity;

		for (const name of HANDLE_NAMES) {
			const actor = selector[name];
			const original = this._handleOpacities?.get(name);
			if (actor && original !== undefined) actor.opacity = original;
		}
	}
}
