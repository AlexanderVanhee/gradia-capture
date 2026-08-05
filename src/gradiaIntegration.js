import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import St from "gi://St";

import { gettext as _ } from "./i18n.js";
import { attachTooltip } from "./tooltip.js";

const GRADIA_FLATPAK_ID = "be.alexandervanhee.gradia";
const GRADIA_DESKTOP_ID = `${GRADIA_FLATPAK_ID}.desktop`;

export function isGradiaFlatpakInstalled() {
	const appInfo = Shell.AppSystem.get_default()
		.lookup_app(GRADIA_DESKTOP_ID)
		?.get_app_info();
	if (!appInfo) return false;
	return !!appInfo.get_string("X-Flatpak");
}

export function launchGradiaForScreenshot(file) {
	if (!file) return;

	const appInfo = Shell.AppSystem.get_default()
		.lookup_app(GRADIA_DESKTOP_ID)
		?.get_app_info();
	if (!appInfo) return;

	try {
		Gio.Subprocess.new(
			["gio", "launch", appInfo.get_filename(), file.get_uri()],
			Gio.SubprocessFlags.NONE,
		);
	} catch (e) {
		console.error(`Failed to spawn Gradia: ${e.message}`);
	}
}

export function openContainingFolder(file) {
	Gio.DBus.session.call(
		"org.freedesktop.FileManager1",
		"/org/freedesktop/FileManager1",
		"org.freedesktop.FileManager1",
		"ShowItems",
		new GLib.Variant("(ass)", [[file.get_uri()], ""]),
		null,
		Gio.DBusCallFlags.NONE,
		-1,
		null,
		null,
	);
}

export function openFileInDefaultApp(file) {
	Gio.app_info_launch_default_for_uri(
		file.get_uri(),
		global.create_app_launch_context(0, -1),
	);
}

export function launchGradiaOcrForFile(file) {
	if (!file) return;
	const path = file.get_path();
	if (!path) return;
	try {
		Gio.Subprocess.new(
			["flatpak", "run", GRADIA_FLATPAK_ID, `--ocr-file=${path}`],
			Gio.SubprocessFlags.NONE,
		);
	} catch (e) {
		console.error(`Failed to spawn Gradia: ${e.message}`);
	}
}

export function createOcrButton(onClick) {
	const button = new St.Button({
		style_class: "screenshot-ui-show-pointer-button",
		icon_name: "scanner-symbolic",
		toggle_mode: false,
	});
	button.connect("clicked", () => onClick());
	attachTooltip(button, _("Extract Text"), St.Side.TOP);
	return button;
}

export function createSettingsButton(onClick) {
	const button = new St.Button({
		style_class: "screenshot-ui-show-pointer-button",
		icon_name: "org.gnome.Settings-symbolic",
		toggle_mode: false,
	});
	button.connect("clicked", () => onClick());
	attachTooltip(button, _("Settings"), St.Side.TOP);
	return button;
}

export function setOcrButtonEnabled(button, enabled) {
	if (!button) return;
	button.reactive = enabled;
	button.ease({
		opacity: enabled ? 255 : 80,
		duration: 200,
		mode: Clutter.AnimationMode.EASE_OUT_QUAD,
	});
}
