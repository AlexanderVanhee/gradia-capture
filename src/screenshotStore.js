import Cogl from "gi://Cogl";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GdkPixbuf from "gi://GdkPixbuf";
import Shell from "gi://Shell";
import St from "gi://St";
import Cairo from "gi://cairo";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "./i18n.js";
import { showScreenshotToast } from "./screenshotToast.js";

function* _suffixes() {
	yield "";
	for (let i = 1; ; i++) yield `-${i}`;
}

function _saveRecentFile(screenshotFile) {
	const recentFile = GLib.build_filenamev([
		GLib.get_user_data_dir(),
		"recently-used.xbel",
	]);
	const uri = screenshotFile.get_uri();
	const bookmarks = new GLib.BookmarkFile();
	try {
		bookmarks.load_from_file(recentFile);
	} catch (e) {
		if (
			!e.matches(
				GLib.BookmarkFileError,
				GLib.BookmarkFileError.FILE_NOT_FOUND,
			)
		)
			return;
	}
	bookmarks.add_application(uri, GLib.get_prgname(), "gio open %u");
	bookmarks.to_file(recentFile);
}

function _pixbufSaveToStreamAsync(pixbuf, format = "png") {
	return new Promise((resolve, reject) => {
		const stream = Gio.MemoryOutputStream.new_resizable();
		pixbuf.save_to_streamv_async(
			stream,
			format,
			[],
			[],
			null,
			(pb, res) => {
				try {
					GdkPixbuf.Pixbuf.save_to_stream_finish(res);
					stream.close(null);
					resolve(stream.steal_as_bytes());
				} catch (e) {
					reject(e);
				}
			},
		);
	});
}

async function _writeBytesToFile(file, bytes) {
	return new Promise((resolve, reject) => {
		const stream = file.create(Gio.FileCreateFlags.NONE, null);
		stream.write_bytes_async(
			bytes,
			GLib.PRIORITY_DEFAULT,
			null,
			(s, res) => {
				try {
					s.write_bytes_finish(res);
					s.close(null);
					_saveRecentFile(file);
					resolve(file);
				} catch (e) {
					reject(e);
				}
			},
		);
	});
}

async function _saveBytesToDir(dir, bytes, format) {
	const timestamp = GLib.DateTime.new_now_local().format("%Y-%m-%d %H-%M-%S");
	const name = `Screenshot From ${timestamp}`;

	for (const suffix of _suffixes()) {
		const file = dir.get_child(`${name}${suffix}.${format}`);
		try {
			return await _writeBytesToFile(file, bytes);
		} catch (e) {
			if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) throw e;
		}
	}
	return null;
}

function _saveToDiskAsync(bytes, format = "png") {
	const lockdownSettings = new Gio.Settings({
		schema_id: "org.gnome.desktop.lockdown",
	});
	if (lockdownSettings.get_boolean("disable-save-to-disk"))
		return Promise.resolve(null);

	const dir = Gio.File.new_for_path(
		GLib.build_filenamev([
			GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ||
				GLib.get_home_dir(),
			"Screenshots",
		]),
	);

	try {
		dir.make_directory_with_parents(null);
	} catch (e) {
		if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) throw e;
	}

	return _saveBytesToDir(dir, bytes, format);
}

function _showToast(file, pixbuf, copyOnly) {
	const coglContext = global.stage.context.get_backend().get_cogl_context();
	const pixels = pixbuf.read_pixel_bytes();
	const imageContent = St.ImageContent.new_with_preferred_size(
		pixbuf.width,
		pixbuf.height,
	);
	imageContent.set_bytes(
		coglContext,
		pixels,
		Cogl.PixelFormat.RGBA_8888,
		pixbuf.width,
		pixbuf.height,
		pixbuf.rowstride,
	);
	showScreenshotToast(
		file,
		imageContent,
		pixbuf.width,
		pixbuf.height,
		copyOnly,
	);
}

async function _storeScreenshotAsync(
	bytes,
	pixbuf,
	{ copy = true, save = true, format = "png", alreadyEncoded = false } = {},
) {
	let finalBytes = bytes;
	if (format !== "png" && !alreadyEncoded && save)
		finalBytes = await _pixbufSaveToStreamAsync(pixbuf, format);

	if (copy) {
		const clipboard = St.Clipboard.get_default();
		clipboard.set_content(St.ClipboardType.CLIPBOARD, "image/png", bytes);
	}

	let file = null;
	if (save) {
		file = await _saveToDiskAsync(finalBytes, format);
		if (file) Main.screenshotUI.emit("screenshot-taken", file);
	}

	if (copy) _showToast(file, pixbuf, copy && !save);

	return file;
}

async function _pickSaveLocationViaPortal(suggestedName) {
	const handle_token = `gradia${Math.floor(Math.random() * 1000000)}`;
	const sender = Gio.DBus.session
		.get_unique_name()
		.replace(/\./g, "_")
		.slice(1);
	const request_path = `/org/freedesktop/portal/desktop/request/${sender}/${handle_token}`;

	return new Promise((resolve, reject) => {
		const sub = Gio.DBus.session.signal_subscribe(
			null,
			"org.freedesktop.portal.Request",
			"Response",
			null,
			null,
			Gio.DBusSignalFlags.NONE,
			(_conn, _sender, path, _iface, _signal, params) => {
				if (path !== request_path) return;
				Gio.DBus.session.signal_unsubscribe(sub);
				const [response, results] = params.deepUnpack();
				if (response !== 0) {
					resolve(null);
					return;
				}
				const uris = results["uris"]?.deepUnpack();
				resolve(uris?.[0] ?? null);
			},
		);

		Gio.DBus.session.call(
			"org.freedesktop.portal.Desktop",
			"/org/freedesktop/portal/desktop",
			"org.freedesktop.portal.FileChooser",
			"SaveFile",
			new GLib.Variant("(ssa{sv})", [
				"",
				_("Save Screenshot As…"),
				{
					handle_token: new GLib.Variant("s", handle_token),
					current_name: new GLib.Variant("s", suggestedName),
				},
			]),
			null,
			Gio.DBusCallFlags.NONE,
			-1,
			null,
			(conn, res) => {
				try {
					conn.call_finish(res);
				} catch (e) {
					Gio.DBus.session.signal_unsubscribe(sub);
					reject(e);
				}
			},
		);
	});
}

async function _saveToUserChosenLocation(bytes, pixbuf, format = "png") {
	const timestamp = GLib.DateTime.new_now_local().format("%Y-%m-%d %H-%M-%S");
	const suggestedName = `Screenshot From ${timestamp}.${format}`;

	const chosenUri = await _pickSaveLocationViaPortal(suggestedName);
	if (!chosenUri) return null;

	let finalBytes = bytes;
	if (format !== "png")
		finalBytes = await _pixbufSaveToStreamAsync(pixbuf, format);

	const file = await _writeBytesToFile(
		Gio.File.new_for_uri(chosenUri),
		finalBytes,
	);
	if (file) _showToast(file, pixbuf, false);
	return file;
}

async function _captureWindowComposite(windowEntries, cursor) {
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	for (const { rect } of windowEntries) {
		minX = Math.min(minX, rect.x);
		minY = Math.min(minY, rect.y);
		maxX = Math.max(maxX, rect.x + rect.width);
		maxY = Math.max(maxY, rect.y + rect.height);
	}

	const outputScale = windowEntries[0].scale;
	const outW = Math.round((maxX - minX) * outputScale);
	const outH = Math.round((maxY - minY) * outputScale);
	const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, outW, outH);
	const cr = new Cairo.Context(surface);

	async function paintEntry(texture, scale, dx, dy) {
		const stream = Gio.MemoryOutputStream.new_resizable();
		const pixbuf = await Shell.Screenshot.composite_to_stream(
			texture,
			0,
			0,
			-1,
			-1,
			scale,
			null,
			0,
			0,
			1,
			stream,
		);
		stream.close(null);
		imports.gi.Gdk.cairo_set_source_pixbuf(cr, pixbuf, dx, dy);
		cr.paint();
	}

	for (const entry of [...windowEntries].reverse())
		await paintEntry(
			entry.texture,
			entry.scale,
			Math.round((entry.rect.x - minX) * outputScale),
			Math.round((entry.rect.y - minY) * outputScale),
		);

	if (cursor?.texture)
		await paintEntry(
			cursor.texture,
			cursor.scale,
			Math.round((cursor.x - minX) * outputScale),
			Math.round((cursor.y - minY) * outputScale),
		);

	cr.$dispose();

	const finalPixbuf = imports.gi.Gdk.pixbuf_get_from_surface(
		surface,
		0,
		0,
		outW,
		outH,
	);
	const bytes = await _pixbufSaveToStreamAsync(finalPixbuf, "png");
	return { bytes, pixbuf: finalPixbuf };
}

export async function captureAndStoreScreenshot(
	texture,
	geometry,
	scale,
	cursor,
	compositeFn,
	windowComposite = null,
	{
		copy = true,
		save = true,
		externalSave = false,
		format = "png",
		playSound = true,
	} = {},
) {
	if (playSound)
		global.display
			.get_sound_player()
			.play_from_theme("screen-capture", _("Screenshot taken"), null);

	let finalBytes,
		finalPixbuf,
		alreadyEncoded = false;

	if (windowComposite) {
		const result = await _captureWindowComposite(
			windowComposite.windows,
			windowComposite.cursor,
		);
		finalBytes = result.bytes;
		finalPixbuf = result.pixbuf;
		alreadyEncoded = true;
	} else {
		const stream = Gio.MemoryOutputStream.new_resizable();
		const [x, y, w, h] = geometry ?? [0, 0, -1, -1];
		if (cursor === null) cursor = { texture: null, x: 0, y: 0, scale: 1 };

		finalPixbuf = await Shell.Screenshot.composite_to_stream(
			texture,
			x,
			y,
			w,
			h,
			scale,
			cursor.texture,
			cursor.x,
			cursor.y,
			cursor.scale,
			stream,
		);
		stream.close(null);
		finalBytes = stream.steal_as_bytes();

		if (compositeFn) {
			const composited = compositeFn(finalBytes, finalPixbuf);
			if (composited) {
				finalPixbuf = composited.pixbuf;
				finalBytes = await _pixbufSaveToStreamAsync(
					finalPixbuf,
					format,
				);
				alreadyEncoded = true;
			}
		}
	}

	if (externalSave)
		return _saveToUserChosenLocation(finalBytes, finalPixbuf, format);

	return _storeScreenshotAsync(finalBytes, finalPixbuf, {
		copy,
		save,
		format,
		alreadyEncoded,
	});
}
