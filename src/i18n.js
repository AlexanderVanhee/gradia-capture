import GLib from 'gi://GLib';
import {bindtextdomain} from 'gettext';

// gettext 域，必须与 metadata.json 的 "gettext-domain" 一致：
// gnome-shell 的 ExtensionBase 构造时会用该域把 <扩展目录>/locale 绑定到 gettext，
// 这里的 bindDomain() 只是把同样的绑定再做一次（幂等），让独立进程（如测试脚本）也能用。
export const DOMAIN = 'gradia-capture';

let _bound = false;

export function bindDomain(localeDir) {
    if (_bound || !localeDir)
        return;
    bindtextdomain(DOMAIN, localeDir);
    _bound = true;
}

// 显式指定域，避免污染 gnome-shell 进程的默认 textdomain（其他扩展依赖它）
export function _(str) {
    return GLib.dgettext(DOMAIN, str);
}

export function n_(str, pluralStr, n) {
    return GLib.dngettext(DOMAIN, str, pluralStr, n);
}

// 标记：用于模块级常量里的文案（模块加载早于 bindtextdomain，此处不能真翻译）。
// 它的唯一作用是让 xgettext 能扫到这些字符串；取用时要再套一次 _()。
export function N_(str) {
    return str;
}
