import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { showScreenshotToast } from './screenshotToast.js';

function* _suffixes() {
    yield '';
    for (let i = 1; ; i++)
        yield `-${i}`;
}

function _saveRecentFile(screenshotFile) {
    const recentFile = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
    const uri = screenshotFile.get_uri();
    const bookmarks = new GLib.BookmarkFile();
    try {
        bookmarks.load_from_file(recentFile);
    } catch (e) {
        if (!e.matches(GLib.BookmarkFileError, GLib.BookmarkFileError.FILE_NOT_FOUND))
            return;
    }
    bookmarks.add_application(uri, GLib.get_prgname(), 'gio open %u');
    bookmarks.to_file(recentFile);
}

function _saveToDiskAsync(bytes, format = 'png') {
    const lockdownSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.lockdown'});
    if (lockdownSettings.get_boolean('disable-save-to-disk'))
        return Promise.resolve(null);

    const dir = Gio.File.new_for_path(GLib.build_filenamev([
        GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) || GLib.get_home_dir(),
        'Screenshots',
    ]));

    try {
        dir.make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }

    const timestamp = GLib.DateTime.new_now_local().format('%Y-%m-%d %H-%M-%S');
    const name = `Screenshot From ${timestamp}`;

    for (const suffix of _suffixes()) {
        const file = Gio.File.new_for_path(GLib.build_filenamev([
            dir.get_path(), `${name}${suffix}.${format}`,
        ]));
        try {
            const stream = file.create(Gio.FileCreateFlags.NONE, null);
            return new Promise((resolve, reject) => {
                stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                    try {
                        s.write_bytes_finish(res);
                        s.close(null);
                        _saveRecentFile(file);
                        resolve(file);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                throw e;
        }
    }

    return Promise.resolve(null);
}

function _pixbufSaveToStreamAsync(pixbuf, format = 'png') {
    return new Promise((resolve, reject) => {
        const stream = Gio.MemoryOutputStream.new_resizable();
        pixbuf.save_to_streamv_async(stream, format, [], [], null, (pb, res) => {
            try {
                GdkPixbuf.Pixbuf.save_to_stream_finish(res);
                stream.close(null);
                resolve(stream.steal_as_bytes());
            } catch (e) {
                reject(e);
            }
        });
    });
}

async function _storeScreenshotAsync(bytes, pixbuf, { copy = true, save = true, format = 'png', alreadyEncoded = false } = {}) {
    let finalBytes = bytes;
    if (format !== 'png' && !alreadyEncoded)
        finalBytes = await _pixbufSaveToStreamAsync(pixbuf, format);

    if (copy) {
        const clipboard = St.Clipboard.get_default();
        clipboard.set_content(St.ClipboardType.CLIPBOARD, `image/${format}`, finalBytes);
    }

    let file = null;
    if (save) {
        file = await _saveToDiskAsync(finalBytes, format);
        if (file)
            Main.screenshotUI.emit('screenshot-taken', file);
    }

    if (copy) {
        const coglContext = global.stage.context.get_backend().get_cogl_context();
        const pixels = pixbuf.read_pixel_bytes();
        const imageContent = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
        imageContent.set_bytes(
            coglContext,
            pixels,
            Cogl.PixelFormat.RGBA_8888,
            pixbuf.width,
            pixbuf.height,
            pixbuf.rowstride
        );

        showScreenshotToast(file, imageContent, pixbuf.width, pixbuf.height, copy && !save);
    }

    return file;
}

export async function captureAndStoreScreenshot(texture, geometry, scale, cursor, compositeFn, { copy = true, save = true, format = 'png', noise='true' } = {}) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    const [x, y, w, h] = geometry ?? [0, 0, -1, -1];
    if (cursor === null)
        cursor = {texture: null, x: 0, y: 0, scale: 1};

    if (noise)
        global.display.get_sound_player().play_from_theme('screen-capture', 'Screenshot taken', null);

    let pixbuf = await Shell.Screenshot.composite_to_stream(
        texture,
        x, y, w, h,
        scale,
        cursor.texture, cursor.x, cursor.y, cursor.scale,
        stream
    );

    stream.close(null);
    const originalBytes = stream.steal_as_bytes();

    let finalBytes = originalBytes;
    let finalPixbuf = pixbuf;
    let alreadyEncoded = false;

    if (compositeFn) {
        const composited = compositeFn(originalBytes, pixbuf);
        if (composited) {
            finalPixbuf = composited.pixbuf;
            finalBytes = await _pixbufSaveToStreamAsync(finalPixbuf, format);
            alreadyEncoded = true;
        }
    }

    return _storeScreenshotAsync(finalBytes, finalPixbuf, { copy, save, format, alreadyEncoded });
}
