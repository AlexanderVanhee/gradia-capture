// i18n.js - Per-extension language override for Gradia Capture.
//
// By default the extension's gettext domain follows the system locale.
// This module additionally reads the `language` GSettings key so the user can
// force the interface into a specific language (e.g. "zh_CN") independently
// of the system locale. When the key is "system" (the default), the standard
// gettext fallback is used.
//
// The override works by parsing the extension's compiled .mo files directly
// (they are placed under <extension-path>/locale/<lang>/LC_MESSAGES/), because
// the GNOME Shell gettext machinery always resolves against the process
// environment and cannot be switched per-extension.

import Gio from "gi://Gio";

const GETTEXT_DOMAIN = "gradia-capture";
const SYSTEM_LANGUAGE = "system";

// Supported language choices shown in the settings combo row.
// `label` is a translatable msgid; `native` is the language name shown as-is.
export const LANGUAGES = [
	{ id: SYSTEM_LANGUAGE, label: "System Default", native: null },
	{ id: "en", label: "English", native: "English" },
	{ id: "zh_CN", label: "Simplified Chinese", native: "简体中文" },
	{ id: "ja", label: "Japanese", native: "日本語" },
];

const _moCache = new Map();

let _fallbackGettext = (msgid) => msgid;
let _localeDir = "";
let _settings = null;

export function initI18n({ fallback, localeDir, settings }) {
	_fallbackGettext = fallback;
	_localeDir = localeDir;
	_settings = settings;
}

export function getLanguage() {
	if (!_settings) return SYSTEM_LANGUAGE;
	return _settings.get_string("language") || SYSTEM_LANGUAGE;
}

function _parseMo(bytes) {
	// `bytes` is a Uint8Array of the .mo file. Layout:
	//   magic(4) revision(4) nstrings(4) origTbl(4) transTbl(4) hashSize(4) hashTbl(4)
	//   then two string tables; each entry is (length u32, offset u32).
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const littleEndian = view.getUint32(0, true) === 0x950412de;
	const bigEndian = view.getUint32(0, false) === 0x950412de;
	if (!littleEndian && !bigEndian) return null;

	const nStrings = view.getUint32(8, littleEndian);
	const origTable = view.getUint32(12, littleEndian);
	const transTable = view.getUint32(16, littleEndian);

	const decoder = new TextDecoder();
	const table = new Map();
	for (let i = 0; i < nStrings; i++) {
		const origLen = view.getUint32(origTable + i * 8, littleEndian);
		const origOff = view.getUint32(origTable + i * 8 + 4, littleEndian);
		const transLen = view.getUint32(transTable + i * 8, littleEndian);
		const transOff = view.getUint32(transTable + i * 8 + 4, littleEndian);

		const key = decoder.decode(bytes.subarray(origOff, origOff + origLen));
		const value = decoder.decode(
			bytes.subarray(transOff, transOff + transLen),
		);
		table.set(key, value);
	}
	return table;
}

function _loadTranslations(lang) {
	if (_moCache.has(lang)) return _moCache.get(lang);

	let table = null;
	const moPath = `${_localeDir}/${lang}/LC_MESSAGES/${GETTEXT_DOMAIN}.mo`;
	const file = Gio.File.new_for_path(moPath);
	if (file.query_exists(null)) {
		const [, contents] = file.load_contents(null);
		table = _parseMo(contents);
	}
	_moCache.set(lang, table);
	return table;
}

export function gettext(msgid) {
	const lang = getLanguage();
	if (lang !== SYSTEM_LANGUAGE) {
		const table = _loadTranslations(lang);
		if (table) {
			const translated = table.get(msgid);
			if (translated) return translated;
		}
		// The source strings are English, so "en" needs no .mo file.
		if (lang === "en") return msgid;
	}
	return _fallbackGettext(msgid);
}
