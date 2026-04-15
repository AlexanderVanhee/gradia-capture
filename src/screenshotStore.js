import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {showScreenshotToast} from './screenshotToast.js';

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

export function storeScreenshot(bytes, pixbuf) {
    const clipboard = St.Clipboard.get_default();
    clipboard.set_content(St.ClipboardType.CLIPBOARD, 'image/png', bytes);

    const time = GLib.DateTime.new_now_local();
    const lockdownSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.lockdown'});
    const disableSaveToDisk = lockdownSettings.get_boolean('disable-save-to-disk');

    let file;

    if (!disableSaveToDisk) {
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

        const timestamp = time.format('%Y-%m-%d %H-%M-%S');
        const name = `Screenshot From ${timestamp}`;

        for (const suffix of _suffixes()) {
            file = Gio.File.new_for_path(GLib.build_filenamev([
                dir.get_path(), `${name}${suffix}.png`,
            ]));
            try {
                const stream = file.create(Gio.FileCreateFlags.NONE, null);
                stream.write_bytes(bytes, null);
                break;
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                    throw e;
            }
        }

        _saveRecentFile(file);
    }

    const coglContext = global.stage.context.get_backend().get_cogl_context();
    const pixels = pixbuf.read_pixel_bytes();
    const content = St.ImageContent.new_with_preferred_size(pixbuf.width, pixbuf.height);
    content.set_bytes(
        coglContext,
        pixels,
        Cogl.PixelFormat.RGBA_8888,
        pixbuf.width,
        pixbuf.height,
        pixbuf.rowstride
    );

    showScreenshotToast(file ?? null, content, pixbuf.width, pixbuf.height);
    return file;
}

export async function captureAndStoreScreenshot(texture, geometry, scale, cursor, compositeFn) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    const [x, y, w, h] = geometry ?? [0, 0, -1, -1];
    if (cursor === null)
        cursor = {texture: null, x: 0, y: 0, scale: 1};

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

    if (compositeFn) {
        const result = compositeFn(originalBytes, pixbuf);
        if (result) {
            finalBytes = result.bytes;
            finalPixbuf = result.pixbuf;
        }
    }

    return storeScreenshot(finalBytes, finalPixbuf);
}
