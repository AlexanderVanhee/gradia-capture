import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';

const PIXELATE_BLOCK_SIZE = 16;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function distanceSquaredToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        const x = px - ax;
        const y = py - ay;
        return x * x + y * y;
    }

    const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
    const nx = ax + t * dx;
    const ny = ay + t * dy;
    const x = px - nx;
    const y = py - ny;
    return x * x + y * y;
}

function addTouchedBlocksForSegment(blocks, gridWidth, width, height, blockSize, radius, a, b) {
    const blockReach = radius + Math.SQRT2 * blockSize / 2;
    const minBlockX = clamp(Math.floor((Math.min(a.x, b.x) - blockReach) / blockSize), 0, gridWidth - 1);
    const maxBlockX = clamp(Math.floor((Math.max(a.x, b.x) + blockReach) / blockSize), 0, gridWidth - 1);
    const gridHeight = Math.ceil(height / blockSize);
    const minBlockY = clamp(Math.floor((Math.min(a.y, b.y) - blockReach) / blockSize), 0, gridHeight - 1);
    const maxBlockY = clamp(Math.floor((Math.max(a.y, b.y) + blockReach) / blockSize), 0, gridHeight - 1);
    const reachSquared = blockReach * blockReach;

    for (let by = minBlockY; by <= maxBlockY; by++) {
        const centerY = Math.min(height - 0.5, by * blockSize + blockSize / 2);
        for (let bx = minBlockX; bx <= maxBlockX; bx++) {
            const centerX = Math.min(width - 0.5, bx * blockSize + blockSize / 2);
            if (distanceSquaredToSegment(centerX, centerY, a.x, a.y, b.x, b.y) <= reachSquared)
                blocks.add(by * gridWidth + bx);
        }
    }
}

function averageBlock(source, rowstride, nChannels, x0, y0, x1, y1) {
    let r = 0, g = 0, b = 0, a = 0, count = 0;

    for (let y = y0; y < y1; y++) {
        let offset = y * rowstride + x0 * nChannels;
        for (let x = x0; x < x1; x++) {
            r += source[offset];
            g += source[offset + 1];
            b += source[offset + 2];
            if (nChannels >= 4)
                a += source[offset + 3];
            offset += nChannels;
            count++;
        }
    }

    if (count === 0)
        return [0, 0, 0, 0];

    return [
        Math.round(r / count),
        Math.round(g / count),
        Math.round(b / count),
        nChannels >= 4 ? Math.round(a / count) : 255,
    ];
}

function fillBlock(target, rowstride, nChannels, x0, y0, x1, y1, color) {
    for (let y = y0; y < y1; y++) {
        let offset = y * rowstride + x0 * nChannels;
        for (let x = x0; x < x1; x++) {
            target[offset] = color[0];
            target[offset + 1] = color[1];
            target[offset + 2] = color[2];
            if (nChannels >= 4)
                target[offset + 3] = color[3];
            offset += nChannels;
        }
    }
}

function pixelatedStrokeBlocks(pixbuf, points, brushWidth) {
    if (!pixbuf || !points || points.length < 2)
        return [];

    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();

    if (width <= 0 || height <= 0 || nChannels < 3)
        return [];

    const radius = Math.max(1, brushWidth / 2);
    const gridWidth = Math.ceil(width / PIXELATE_BLOCK_SIZE);
    const touchedBlocks = new Set();

    // Mark affected mosaic cells first, then average each one exactly once so
    // dense pointer motion does not repeatedly smear already-processed pixels.
    for (let i = 1; i < points.length; i++)
        addTouchedBlocksForSegment(touchedBlocks, gridWidth, width, height, PIXELATE_BLOCK_SIZE, radius, points[i - 1], points[i]);

    if (touchedBlocks.size === 0)
        return [];

    const source = pixbuf.get_pixels();
    const blocks = [];

    for (const block of touchedBlocks) {
        const bx = block % gridWidth;
        const by = Math.floor(block / gridWidth);
        const x = bx * PIXELATE_BLOCK_SIZE;
        const y = by * PIXELATE_BLOCK_SIZE;
        const width = Math.min(pixbuf.get_width(), x + PIXELATE_BLOCK_SIZE) - x;
        const height = Math.min(pixbuf.get_height(), y + PIXELATE_BLOCK_SIZE) - y;
        const color = averageBlock(source, rowstride, nChannels, x, y, x + width, y + height);

        blocks.push({ x, y, width, height, color });
    }

    return blocks;
}

export function pixelatePixbufAlongStroke(pixbuf, points, brushWidth) {
    const blocks = pixelatedStrokeBlocks(pixbuf, points, brushWidth);

    if (blocks.length === 0)
        return pixbuf;

    const source = pixbuf.get_pixels();
    const target = new Uint8Array(source);
    const rowstride = pixbuf.get_rowstride();
    const nChannels = pixbuf.get_n_channels();

    for (const block of blocks)
        fillBlock(target, rowstride, nChannels, block.x, block.y, block.x + block.width, block.y + block.height, block.color);

    const bytes = GLib.Bytes.new(target);
    return GdkPixbuf.Pixbuf.new_from_bytes(
        bytes,
        GdkPixbuf.Colorspace.RGB,
        pixbuf.get_has_alpha(),
        pixbuf.get_bits_per_sample(),
        pixbuf.get_width(),
        pixbuf.get_height(),
        pixbuf.get_rowstride()
    );
}
