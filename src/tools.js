import Cairo from 'gi://cairo';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import Clutter from 'gi://Clutter';

export const SELECTION_PADDING = 8;
const PIXELATE_PATTERN_SIZE = 16;

function hexToRgb(hex) {
    return {
        r: parseInt(hex.slice(1, 3), 16) / 255,
        g: parseInt(hex.slice(3, 5), 16) / 255,
        b: parseInt(hex.slice(5, 7), 16) / 255,
    };
}

function rectBounds(pts, pad) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function rectHit(bounds, sx, sy) {
    return sx >= bounds.minX && sx <= bounds.maxX && sy >= bounds.minY && sy <= bounds.maxY;
}

function makeStrokeBounds(padFn) {
    return function(stroke) {
        return rectBounds(stroke.stagePoints, padFn(stroke));
    };
}

function standardHitTest(stroke, sx, sy) {
    return rectHit(this.bounds(stroke), sx, sy);
}

let pixelatePatternCache = null;

function createPixelatePattern(tileSize) {
    const size = Math.max(4, Math.round(tileSize));
    if (pixelatePatternCache?.size === size)
        return pixelatePatternCache.pattern;

    const half = Math.max(2, Math.floor(size / 2));
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, size, size);
    const patternCr = new Cairo.Context(surface);

    patternCr.setSourceRGB(1, 1, 1);
    patternCr.paint();
    patternCr.setSourceRGB(0, 0, 0);
    patternCr.rectangle(0, 0, half, half);
    patternCr.rectangle(half, half, size - half, size - half);
    patternCr.fill();
    patternCr.$dispose();

    const pattern = new Cairo.SurfacePattern(surface);
    pattern.setExtend(Cairo.Extend.REPEAT);
    pattern.setFilter(Cairo.Filter.NEAREST);
    pixelatePatternCache = { size, pattern };
    return pattern;
}

function strokePath(cr, points) {
    cr.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++)
        cr.lineTo(points[i].x, points[i].y);
}

export const TOOLS = [
    {
        id: 'select',
        name: 'Crop',
        icon: 'icons/selection-opaque-3-symbolic.svg',
        keybindings: [Clutter.KEY_1, Clutter.KEY_ampersand, Clutter.KEY_q],
        isDrawing: false,
        render: null,
        beginStroke: null,
        bounds: null,
        hitTest: null,
    },
    {
        id: 'drag',
        name: 'Drag',
        icon: 'icons/pointer-primary-click-symbolic.svg',
        keybindings: [Clutter.KEY_2, Clutter.KEY_eacute, Clutter.KEY_d],
        isDrawing: false,
        isDrag: true,
        render: null,
        beginStroke: null,
        bounds: null,
        hitTest: null,
    },
    {
        id: 'freehand',
        name: 'Freehand',
        icon: 'document-edit-symbolic',
        keybindings: [Clutter.KEY_3, Clutter.KEY_quotedbl, Clutter.KEY_f],
        isDrawing: true,
        beginStroke: () => ({}),
        bounds: makeStrokeBounds(s => SELECTION_PADDING + (s.strokeWidth ?? 4)),
        hitTest: standardHitTest,
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2) return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.setLineWidth(lineWidth);
            cr.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++)
                cr.lineTo(stroke.points[i].x, stroke.points[i].y);
            cr.stroke();
        },
    },
    {
        id: 'rectangle',
        name: 'Rectangle',
        icon: 'icons/square-outline-thick-symbolic.svg',
        keybindings: [Clutter.KEY_4, Clutter.KEY_apostrophe, Clutter.KEY_r],
        isDrawing: true,
        beginStroke: () => ({}),
        bounds: makeStrokeBounds(s => SELECTION_PADDING + (s.strokeWidth ?? 4)),
        hitTest: standardHitTest,
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2) return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.setLineWidth(lineWidth);
            const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
            cr.rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
            cr.stroke();
        },
    },
    {
        id: 'solid-rectangle',
        name: 'Solid Rectangle',
        icon: 'icons/square-filled-symbolic.svg',
        keybindings: [Clutter.KEY_5, Clutter.KEY_parenleft, Clutter.KEY_b],
        isDrawing: true,
        beginStroke: () => ({}),
        bounds: makeStrokeBounds(() => SELECTION_PADDING),
        hitTest: standardHitTest,
        render(cr, stroke, _lineWidth) {
            if (stroke.points.length < 2) return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
            cr.rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
            cr.fill();
        },
    },
    {
        id: 'highlighter',
        name: 'Highlighter',
        icon: 'icons/marker-symbolic.svg',
        keybindings: [Clutter.KEY_6, Clutter.KEY_section, Clutter.KEY_h],
        isDrawing: true,
        beginStroke: () => ({}),
        bounds: makeStrokeBounds(s => SELECTION_PADDING + (s.strokeWidth ?? 4) * 4),
        hitTest: standardHitTest,
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2) return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 0.4);
            cr.setLineWidth(lineWidth * 4);
            cr.setLineCap(Cairo.LineCap.SQUARE);
            cr.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++)
                cr.lineTo(stroke.points[i].x, stroke.points[i].y);
            cr.stroke();
        },
    },
    {
        id: 'arrow',
        name: 'Arrow',
        icon: 'icons/arrow1-top-right-symbolic.svg',
        keybindings: [Clutter.KEY_7, Clutter.KEY_egrave, Clutter.KEY_a],
        isDrawing: true,
        beginStroke: () => ({}),
        bounds: makeStrokeBounds(s => SELECTION_PADDING + (s.strokeWidth ?? 4) * 2),
        hitTest: standardHitTest,
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2) return;
            const { r, g, b } = hexToRgb(stroke.color);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.setLineWidth(lineWidth);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            const p0 = stroke.points[0], p1 = stroke.points[stroke.points.length - 1];
            cr.moveTo(p0.x, p0.y);
            cr.lineTo(p1.x, p1.y);
            cr.stroke();

            const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            const spread = Math.PI / 7;
            const size = lineWidth * 5;
            cr.moveTo(p1.x, p1.y);
            cr.lineTo(p1.x - size * Math.cos(angle - spread), p1.y - size * Math.sin(angle - spread));
            cr.moveTo(p1.x, p1.y);
            cr.lineTo(p1.x - size * Math.cos(angle + spread), p1.y - size * Math.sin(angle + spread));
            cr.stroke();
        },
    },
    {
        id: 'text',
        name: 'Text',
        icon: 'icons/text-insert2-symbolic.svg',
        keybindings: [Clutter.KEY_8, Clutter.KEY_exclam, Clutter.KEY_t],
        isDrawing: true,
        isText: true,
        beginStroke: () => ({ text: '' }),
        bounds(stroke) {
            const pt = stroke.stagePoints[0];
            const fontSize = Math.max(8, Math.round((stroke.strokeWidth ?? 4) * 3));

            if (!stroke.text)
                return {
                    minX: pt.x - SELECTION_PADDING,
                    minY: pt.y - SELECTION_PADDING,
                    maxX: pt.x + SELECTION_PADDING,
                    maxY: pt.y + SELECTION_PADDING,
                };

            const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 1, 1);
            const cr = new Cairo.Context(surface);
            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(fontSize);
            const extents = cr.textExtents(stroke.text);
            cr.$dispose();
            surface.finish();

            return {
                minX: pt.x - SELECTION_PADDING,
                minY: pt.y - SELECTION_PADDING,
                maxX: pt.x + extents.width + SELECTION_PADDING,
                maxY: pt.y + extents.height + SELECTION_PADDING,
            };
        },
        hitTest(stroke, sx, sy) {
            if (!stroke.text || stroke.stagePoints.length < 1) return false;
            return rectHit(this.bounds(stroke), sx, sy);
        },
        render(cr, stroke, lineWidth) {
            if (!stroke.text || stroke.points.length < 1) return;
            const pt = stroke.points[0];
            const { r, g, b } = hexToRgb(stroke.color);
            const fontSize = Math.max(8, Math.round(lineWidth * 3));

            cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);
            cr.setFontSize(fontSize);

            const extents = cr.textExtents(stroke.text);
            cr.setSourceRGBA(r, g, b, 1.0);
            cr.moveTo(pt.x - extents.xBearing, pt.y - extents.yBearing);
            cr.showText(stroke.text);
        },
    },
    {
        id: 'stamp',
        name: 'Number Stamp',
        icon: 'icons/one-circle-symbolic.svg',
        keybindings: [Clutter.KEY_9, Clutter.KEY_ccedilla, Clutter.KEY_n],
        isDrawing: true,
        isStamp: true,
        beginStroke: () => ({ counter: 1 }),
        bounds(stroke) {
            const pt = stroke.stagePoints[0];
            const r = (stroke.strokeWidth ?? 4) * 5 + SELECTION_PADDING;
            return { minX: pt.x - r, minY: pt.y - r, maxX: pt.x + r, maxY: pt.y + r };
        },
        hitTest(stroke, sx, sy) {
            if (stroke.stagePoints.length < 1) return false;
            return rectHit(this.bounds(stroke), sx, sy);
        },
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 1) return;
            const pt = stroke.points[0];
            const radius = lineWidth * 5;
            const rgb = hexToRgb(stroke.color);
            const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
            const textColor = lum > 0.5 ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 };

            cr.setSourceRGBA(rgb.r, rgb.g, rgb.b, 1.0);
            cr.arc(pt.x, pt.y, radius, 0, 2 * Math.PI);
            cr.fill();

            const label = String(stroke.counter ?? 1);
            const fontSize = Math.round(radius * 1.2);

            const layout = PangoCairo.create_layout(cr);
            const desc = Pango.font_description_from_string(`Sans Bold ${fontSize}px`);
            layout.set_font_description(desc);
            layout.set_text(label, -1);

            const [, extents] = layout.get_pixel_extents();

            cr.setSourceRGBA(textColor.r, textColor.g, textColor.b, 1.0);
            cr.moveTo(pt.x - extents.width / 2 - extents.x, pt.y - extents.height / 2 - extents.y);
            PangoCairo.show_layout(cr, layout);
        },
    },
    {
        id: 'pixelate',
        name: 'Pixelate',
        icon: 'icons/pixelate-symbolic.svg',
        keybindings: [Clutter.KEY_0, Clutter.KEY_agrave, Clutter.KEY_m],
        isDrawing: true,
        beginStroke: () => ({}),
        bounds: makeStrokeBounds(s => SELECTION_PADDING + (s.strokeWidth ?? 32) / 2),
        hitTest: standardHitTest,
        render(cr, stroke, lineWidth) {
            if (stroke.points.length < 2) return;

            const pattern = createPixelatePattern(PIXELATE_PATTERN_SIZE);
            cr.save();
            cr.setLineWidth(lineWidth);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setLineJoin(Cairo.LineJoin.ROUND);
            cr.setSource(pattern);
            strokePath(cr, stroke.points);
            cr.stroke();
            cr.restore();
        },
    },
];

export const TOOL_SHORTCUTS = Object.fromEntries(
    TOOLS.flatMap(t => t.keybindings.map(key => [key, t.id]))
);
