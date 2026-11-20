const ExporterColorUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./utils')
  : window.ColorUtils;

const ASPECT_RATIOS = {
  '1:1': { width: 1500, height: 1500 },
  '4:5': { width: 1200, height: 1500 },
  '5:4': { width: 1500, height: 1200 },
  '4:3': { width: 1600, height: 1200 },
  '3:4': { width: 1200, height: 1600 },
  '3:2': { width: 1800, height: 1200 },
  '2:3': { width: 1200, height: 1800 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 }
};

const MAX_STRIP_COLORS = 10;

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO_STACK = 'monospace';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveSwatchLayout(layout, count) {
  const valid = layout === 'vertical' || layout === 'horizontal' || layout === 'squares';
  if (!valid) return count > MAX_STRIP_COLORS ? 'squares' : 'vertical';
  if (layout !== 'squares' && count > MAX_STRIP_COLORS) return 'squares';
  return layout;
}

// Correctly rounded rectangle. The previous implementation passed the wrong
// target points to arcTo, which produced the distorted "blob" shapes.
function roundRectPath(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// Pick the best square-grid shape for a given area, then centre it.
function computeSquareGrid(areaX, areaY, areaW, areaH, count, gap, maxTile) {
  let bestCols = 1;
  let bestSize = 0;
  const maxCols = Math.min(count, 8);

  for (let cols = 1; cols <= maxCols; cols++) {
    const rows = Math.ceil(count / cols);
    const size = Math.min(
      (areaW - gap * (cols - 1)) / cols,
      (areaH - gap * (rows - 1)) / rows
    );
    if (size > bestSize) {
      bestSize = size;
      bestCols = cols;
    }
  }

  const size = Math.min(bestSize, maxTile);
  const rows = Math.ceil(count / bestCols);
  const gridW = bestCols * size + (bestCols - 1) * gap;
  const gridH = rows * size + (rows - 1) * gap;

  return {
    cols: bestCols,
    rows,
    size,
    x: areaX + (areaW - gridW) / 2,
    y: areaY + (areaH - gridH) / 2
  };
}

const Exporter = {
  ASPECT_RATIOS,
  MAX_STRIP_COLORS,

  escapeXml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;'
    }[char]));
  },

  wrapText(text, maxWidth, measure) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (words.length === 0) return [''];

    const lines = [];
    let line = '';

    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
        line = '';
      }

      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }

      for (const char of word) {
        const test = line + char;
        if (line && measure(test) > maxWidth) {
          lines.push(line);
          line = char;
        } else {
          line = test;
        }
      }
    }

    if (line) lines.push(line);
    return lines.length ? lines : [''];
  },

  ellipsize(text, maxWidth, measure) {
    let value = String(text);
    while (value.length > 0 && measure(`${value}…`) > maxWidth) {
      value = value.slice(0, -1);
    }
    return `${value.replace(/\s+$/, '')}…`;
  },

  titleLines(text, maxWidth, measure, maxLines = 2) {
    const lines = this.wrapText(text, maxWidth, measure);
    if (lines.length <= maxLines) return lines;
    const visible = lines.slice(0, maxLines - 1);
    visible.push(this.ellipsize(lines.slice(maxLines - 1).join(' '), maxWidth, measure));
    return visible;
  },

  toCssVariables(hexList, prefix = '--color-') {
    const lines = hexList.map((hex, i) => `  ${prefix}${i + 1}: ${hex};`);
    return `:root {\n${lines.join('\n')}\n}`;
  },

  toScssVariables(hexList, prefix = '$color-') {
    return hexList.map((hex, i) => `${prefix}${i + 1}: ${hex};`).join('\n');
  },

  toTailwind(hexList) {
    const obj = {};
    hexList.forEach((hex, i) => {
      obj[`color-${i + 1}`] = hex;
    });
    return `module.exports = {\n  theme: {\n    extend: {\n      colors: {\n        palette: ${JSON.stringify(obj, null, 8).replace(/^/gm, '  ').trim()}\n      }\n    }\n  }\n};`;
  },

  toJson(hexList) {
    const data = hexList.map((hex, i) => {
      const rgb = ExporterColorUtils.hexToRgb(hex);
      const hsl = ExporterColorUtils.rgbToHsl(rgb.r, rgb.g, rgb.b);
      const hsv = ExporterColorUtils.rgbToHsv(rgb.r, rgb.g, rgb.b);
      return {
        id: i + 1,
        hex,
        rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
        hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
        hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`
      };
    });
    return JSON.stringify(data, null, 2);
  },

  toHexList(hexList, separator = '\n') {
    return hexList.join(separator);
  },

  toHslList(hexList, separator = '\n') {
    return hexList.map(hex => {
      const rgb = ExporterColorUtils.hexToRgb(hex);
      const hsl = ExporterColorUtils.rgbToHsl(rgb.r, rgb.g, rgb.b);
      return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    }).join(separator);
  },

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  downloadText(text, filename, mimeType = 'text/plain') {
    const blob = new Blob([text], { type: mimeType });
    this.downloadBlob(blob, filename);
  },

  downloadASE(hexList, filename = 'hue.tf-palette.ase') {
    const bytes = ExporterColorUtils.generateASE(hexList);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    this.downloadBlob(blob, filename);
  },

  // Loads logo.svg once and turns it into a data URL that can be used both as a canvas image and as an <image> in the standalone SVG export.
  async loadLogoDataUrl() {
    if (this._logoDataUrl !== undefined) return this._logoDataUrl;
    if (this._logoDataUrlPromise) return this._logoDataUrlPromise;

    this._logoDataUrlPromise = (async () => {
      try {
        if (typeof fetch === 'function' && typeof document !== 'undefined') {
          const response = await fetch(new URL('logo.svg', document.baseURI).href);
          if (response.ok) {
            const svg = await response.text();
            this._logoDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
            return this._logoDataUrl;
          }
        }
      } catch (err) {}

      // Fallback for environments where fetching the file is blocked (e.g. some file:// setups): rasterise the logo already in the page header.
      try {
        const existing = typeof document !== 'undefined'
          ? document.querySelector('.brand-lockup')
          : null;
        if (existing && existing.complete && existing.naturalWidth) {
          const logoCanvas = document.createElement('canvas');
          logoCanvas.width = existing.naturalWidth * 2;
          logoCanvas.height = existing.naturalHeight * 2;
          logoCanvas.getContext('2d').drawImage(existing, 0, 0, logoCanvas.width, logoCanvas.height);
          this._logoDataUrl = logoCanvas.toDataURL('image/png');
          return this._logoDataUrl;
        }
      } catch (err) {}

      this._logoDataUrl = null;
      return null;
    })();

    return this._logoDataUrlPromise;
  },

  async loadLogoImage() {
    if (this._logoImagePromise) return this._logoImagePromise;

    this._logoImagePromise = (async () => {
      const dataUrl = await this.loadLogoDataUrl();
      if (!dataUrl) return null;
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = dataUrl;
      });
    })();

    return this._logoImagePromise;
  },

  getTitleFontSize(width, height) {
    return Math.round(clamp(Math.min(width, height) * 0.034, 26, 54));
  },

  getCardMetrics({ width, height, titleLineCount, includeBranding, hasLogo }) {
    const minDim = Math.min(width, height);
    const margin = Math.round(minDim * 0.065);
    const cardX = margin;
    const cardY = margin;
    const cardW = width - margin * 2;
    const cardH = height - margin * 2;

    const titleFontSize = this.getTitleFontSize(width, height);
    const titleLineHeight = Math.round(titleFontSize * 1.14);
    const subtitleFontSize = Math.round(clamp(titleFontSize * 0.46, 12, 26));
    const titleBlockH = titleLineCount * titleLineHeight;
    const subtitleBaseline = cardY + titleBlockH + Math.round(subtitleFontSize * 1.1);
    const swatchesTop = subtitleBaseline + Math.round(titleFontSize * 0.95);

    const taglineFontSize = Math.round(clamp(minDim * 0.011, 11, 17));
    const logoH = hasLogo ? Math.round(clamp(minDim * 0.052, 42, 80)) : 0;
    const logoW = Math.round(logoH * (274 / 100));
    const footerBottom = cardY + cardH;
    const taglineBaseline = footerBottom - 2;
    const logoBottom = taglineBaseline - Math.round(taglineFontSize * 1.7);
    const logoTop = logoBottom - logoH;
    const brandingTop = hasLogo
      ? logoTop
      : taglineBaseline - Math.round(taglineFontSize * 1.4);
    const contentBottom = includeBranding
      ? brandingTop - Math.round(titleFontSize * 0.8)
      : footerBottom;

    return {
      width,
      height,
      minDim,
      margin,
      cardX,
      cardY,
      cardW,
      cardH,
      titleFontSize,
      titleLineHeight,
      subtitleFontSize,
      subtitleBaseline,
      swatchesTop,
      taglineFontSize,
      logoH,
      logoW,
      logoTop,
      logoBottom,
      taglineBaseline,
      contentBottom,
      photoGap: Math.round(titleFontSize * 0.95),
      swatchGap: Math.max(6, Math.round(cardW * 0.012))
    };
  },

  async generatePngCard({
    hexList,
    sourceImage = null,
    includeImage = false,
    bgMode = 'blur',
    blurRadius = 30,
    includeBranding = true,
    title = 'Harmonised Palette',
    aspectRatio = '1:1',
    swatchLayout = 'vertical'
  }) {
    const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1'];
    const width = dims.width;
    const height = dims.height;
    const count = hexList.length;
    const layout = resolveSwatchLayout(swatchLayout, count);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const logoImage = includeBranding ? await this.loadLogoImage() : null;
    const hasLogo = !!(logoImage && logoImage.naturalWidth);

    if (bgMode === 'blur' && sourceImage) {
      ctx.save();
      const scale = 1.2;
      const sw = width * scale;
      const sh = height * scale;
      const sx = (width - sw) / 2;
      const sy = (height - sh) / 2;

      ctx.filter = `blur(${blurRadius}px) brightness(0.55) saturate(1.3)`;
      ctx.drawImage(sourceImage, sx, sy, sw, sh);
      ctx.restore();

      // dark gradient over the blurred photo
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, 'rgba(8, 12, 20, 0.5)');
      grad.addColorStop(1, 'rgba(8, 12, 20, 0.88)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    } else if (bgMode === 'mesh') {
      // mesh gradient built from the palette's own colours
      const c1 = hexList[0] || '#4F46E5';
      const c2 = hexList[Math.floor(hexList.length / 2)] || '#06B6D4';
      const c3 = hexList[hexList.length - 1] || '#9333EA';

      ctx.fillStyle = '#080C14';
      ctx.fillRect(0, 0, width, height);

      const radGrad1 = ctx.createRadialGradient(
        width * 0.17, height * 0.2, 0,
        width * 0.17, height * 0.2, Math.max(width, height) * 0.42
      );
      radGrad1.addColorStop(0, c1 + '55');
      radGrad1.addColorStop(1, 'transparent');
      ctx.fillStyle = radGrad1;
      ctx.fillRect(0, 0, width, height);

      const radGrad2 = ctx.createRadialGradient(
        width * 0.83, height * 0.73, 0,
        width * 0.83, height * 0.73, Math.max(width, height) * 0.45
      );
      radGrad2.addColorStop(0, c2 + '55');
      radGrad2.addColorStop(1, 'transparent');
      ctx.fillStyle = radGrad2;
      ctx.fillRect(0, 0, width, height);

      const radGrad3 = ctx.createRadialGradient(
        width * 0.5, height * 0.5, 0,
        width * 0.5, height * 0.5, Math.max(width, height) * 0.38
      );
      radGrad3.addColorStop(0, c3 + '33');
      radGrad3.addColorStop(1, 'transparent');
      ctx.fillStyle = radGrad3;
      ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = '#080C14';
      ctx.fillRect(0, 0, width, height);
    }

    const titleFontSize = this.getTitleFontSize(width, height);
    const measureWidth = width - Math.round(Math.min(width, height) * 0.065) * 2;
    ctx.font = `800 ${titleFontSize}px ${FONT_STACK}`;
    const titleLines = this.titleLines(title, measureWidth, (text) => ctx.measureText(text).width, 2);
    const m = this.getCardMetrics({
      width,
      height,
      titleLineCount: titleLines.length,
      includeBranding,
      hasLogo
    });

    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${m.titleFontSize}px ${FONT_STACK}`;
    titleLines.forEach((line, index) => {
      ctx.fillText(line, m.cardX, m.cardY + m.titleFontSize + index * m.titleLineHeight);
    });

    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 ${m.subtitleFontSize}px ${FONT_STACK}`;
    ctx.fillText(`${count} Curated Colours`, m.cardX, m.subtitleBaseline);

    let swatchTop = m.swatchesTop;
    let swatchAreaH = m.contentBottom - swatchTop;

    if (includeImage && sourceImage) {
      const available = m.contentBottom - m.swatchesTop;
      let photoH = Math.round(Math.min(available * 0.42, m.cardW * 0.62));
      photoH = Math.max(0, Math.min(photoH, available - 220 - m.photoGap));

      if (photoH > 0) {
        const photoTop = m.swatchesTop;
        const photoRadius = Math.round(clamp(m.minDim * 0.016, 14, 28));

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = Math.round(m.minDim * 0.02);
        ctx.shadowOffsetY = Math.round(m.minDim * 0.008);

        roundRectPath(ctx, m.cardX, photoTop, m.cardW, photoH, photoRadius);
        ctx.fillStyle = '#111827';
        ctx.fill();
        ctx.clip();
        ctx.shadowColor = 'transparent';

        const imgRatio = sourceImage.width / sourceImage.height;
        const boxRatio = m.cardW / photoH;
        let dw, dh, dx, dy;
        if (imgRatio > boxRatio) {
          dh = photoH;
          dw = photoH * imgRatio;
          dx = m.cardX + (m.cardW - dw) / 2;
          dy = photoTop;
        } else {
          dw = m.cardW;
          dh = m.cardW / imgRatio;
          dx = m.cardX;
          dy = photoTop + (photoH - dh) / 2;
        }
        ctx.drawImage(sourceImage, dx, dy, dw, dh);
        ctx.restore();

        swatchTop = photoTop + photoH + m.photoGap;
        swatchAreaH = m.contentBottom - swatchTop;
      }
    }

    if (layout === 'vertical') {
      const gap = m.swatchGap;
      const stripW = (m.cardW - gap * (count - 1)) / count;
      const radius = Math.round(clamp(stripW * 0.14, 8, 22));
      const showRgb = stripW >= 108 && swatchAreaH >= 150;
      const hexFont = Math.round(clamp(stripW * 0.17, 11, 22));
      const rgbFont = Math.round(clamp(stripW * 0.1, 9, 13));
      const bottomPad = Math.round(clamp(stripW * 0.22, 14, 30));
      const topPad = Math.round(clamp(stripW * 0.28, 16, 34));
      const dotR = clamp(stripW * 0.05, 3, 6);

      hexList.forEach((hex, i) => {
        const x = m.cardX + i * (stripW + gap);
        const y = swatchTop;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = Math.round(m.minDim * 0.012);
        ctx.shadowOffsetY = Math.round(m.minDim * 0.005);
        roundRectPath(ctx, x, y, stripW, swatchAreaH, radius);
        ctx.fillStyle = hex;
        ctx.fill();
        ctx.restore();

        const textColor = ExporterColorUtils.getContrastingTextColor(hex);
        const rgb = ExporterColorUtils.hexToRgb(hex);

        ctx.save();
        ctx.fillStyle = textColor;
        ctx.beginPath();
        ctx.arc(x + stripW / 2, y + topPad, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.fillStyle = textColor;
        ctx.font = `700 ${hexFont}px ${MONO_STACK}`;
        const hexY = showRgb
          ? y + swatchAreaH - bottomPad - rgbFont * 1.6
          : y + swatchAreaH - bottomPad;
        ctx.fillText(hex, x + stripW / 2, hexY);

        if (showRgb) {
          ctx.font = `500 ${rgbFont}px ${MONO_STACK}`;
          ctx.fillStyle = textColor === '#F9FAFB'
            ? 'rgba(255, 255, 255, 0.7)'
            : 'rgba(0, 0, 0, 0.7)';
          ctx.fillText(`${rgb.r}, ${rgb.g}, ${rgb.b}`, x + stripW / 2, y + swatchAreaH - bottomPad);
        }
      });
    } else if (layout === 'horizontal') {
      const gap = Math.max(6, Math.round(m.cardW * 0.008));
      const barH = (swatchAreaH - gap * (count - 1)) / count;
      const radius = Math.round(clamp(barH * 0.32, 8, 22));
      const hexFont = Math.round(clamp(Math.min(barH * 0.4, m.cardW * 0.017), 10, 22));
      const rgbFont = Math.round(clamp(barH * 0.26, 9, 14));
      const padX = Math.round(clamp(barH * 0.55, 14, 28));
      const showRgb = barH >= 36 && m.cardW >= 640;

      hexList.forEach((hex, i) => {
        const y = swatchTop + i * (barH + gap);

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
        ctx.shadowBlur = Math.round(m.minDim * 0.012);
        ctx.shadowOffsetY = Math.round(m.minDim * 0.005);
        roundRectPath(ctx, m.cardX, y, m.cardW, barH, radius);
        ctx.fillStyle = hex;
        ctx.fill();
        ctx.restore();

        const textColor = ExporterColorUtils.getContrastingTextColor(hex);

        ctx.textAlign = 'left';
        ctx.fillStyle = textColor;
        ctx.font = `700 ${hexFont}px ${MONO_STACK}`;
        ctx.fillText(hex, m.cardX + padX, y + barH / 2 + hexFont * 0.35);

        if (showRgb) {
          const rgb = ExporterColorUtils.hexToRgb(hex);
          ctx.textAlign = 'right';
          ctx.font = `500 ${rgbFont}px ${MONO_STACK}`;
          ctx.fillStyle = textColor === '#F9FAFB'
            ? 'rgba(255, 255, 255, 0.7)'
            : 'rgba(0, 0, 0, 0.7)';
          ctx.fillText(`${rgb.r}, ${rgb.g}, ${rgb.b}`, m.cardX + m.cardW - padX, y + barH / 2 + rgbFont * 0.35);
        }
      });
    } else {
      const gap = Math.round(clamp(m.minDim * 0.011, 8, 18));
      const maxTile = Math.round(m.minDim * 0.24);
      const grid = computeSquareGrid(m.cardX, swatchTop, m.cardW, swatchAreaH, count, gap, maxTile);
      const radius = Math.round(clamp(grid.size * 0.14, 10, 26));
      const hexFont = Math.round(clamp(grid.size * 0.12, 10, 22));

      hexList.forEach((hex, i) => {
        const row = Math.floor(i / grid.cols);
        const col = i % grid.cols;
        const itemsInRow = Math.min(grid.cols, count - row * grid.cols);
        const rowWidth = itemsInRow * grid.size + (itemsInRow - 1) * gap;
        const x = m.cardX + (m.cardW - rowWidth) / 2 + col * (grid.size + gap);
        const y = grid.y + row * (grid.size + gap);

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
        ctx.shadowBlur = Math.round(m.minDim * 0.008);
        ctx.shadowOffsetY = Math.round(m.minDim * 0.003);
        roundRectPath(ctx, x, y, grid.size, grid.size, radius);
        ctx.fillStyle = hex;
        ctx.fill();
        ctx.restore();

        if (grid.size >= 50) {
          const textColor = ExporterColorUtils.getContrastingTextColor(hex);
          ctx.textAlign = 'center';
          ctx.fillStyle = textColor;
          ctx.font = `700 ${hexFont}px ${MONO_STACK}`;
          ctx.fillText(hex, x + grid.size / 2, y + grid.size / 2 + hexFont * 0.35);
        }
      });
    }

    if (includeBranding) {
      ctx.textAlign = 'center';
      if (hasLogo) {
        ctx.drawImage(logoImage, (width - m.logoW) / 2, m.logoTop, m.logoW, m.logoH);
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = `600 ${m.taglineFontSize}px ${FONT_STACK}`;
      ctx.fillText(
        hasLogo
          ? 'Pixels To Palettes'
          : 'hue.tf • Pixels To Palettes',
        width / 2,
        m.taglineBaseline
      );
    }

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  },

  async generateSvgCard({
    hexList,
    title = 'Harmonised Palette',
    includeBranding = true,
    aspectRatio = '1:1',
    swatchLayout = 'vertical'
  }) {
    const dims = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS['1:1'];
    const width = dims.width;
    const height = dims.height;
    const count = hexList.length;
    const layout = resolveSwatchLayout(swatchLayout, count);
    const logoDataUrl = includeBranding ? await this.loadLogoDataUrl() : null;
    const hasLogo = !!logoDataUrl;

    const titleFontSize = this.getTitleFontSize(width, height);
    const margin = Math.round(Math.min(width, height) * 0.065);
    const titleMeasure = (() => {
      if (typeof document !== 'undefined') {
        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');
        if (measureCtx) {
          measureCtx.font = `bold ${titleFontSize}px sans-serif`;
          return (text) => measureCtx.measureText(text).width;
        }
      }
      return (text) => String(text).length * titleFontSize * 0.55;
    })();

    const titleLines = this.titleLines(title, width - margin * 2, titleMeasure, 2);
    const m = this.getCardMetrics({
      width,
      height,
      titleLineCount: titleLines.length,
      includeBranding,
      hasLogo
    });

    const titleSvg = titleLines.map((line, index) =>
      `<tspan x="${m.cardX}" ${index === 0 ? `y="${m.cardY + m.titleFontSize}"` : `dy="${m.titleLineHeight}"`}>${this.escapeXml(line)}</tspan>`
    ).join('');

    const swatchTop = m.swatchesTop;
    const swatchAreaH = m.contentBottom - swatchTop;
    let swatchesSvg = '';

    if (layout === 'vertical') {
      const gap = m.swatchGap;
      const stripW = (m.cardW - gap * (count - 1)) / count;
      const radius = Math.round(clamp(stripW * 0.14, 8, 22));
      const showRgb = stripW >= 108 && swatchAreaH >= 150;
      const hexFont = Math.round(clamp(stripW * 0.17, 11, 22));
      const rgbFont = Math.round(clamp(stripW * 0.1, 9, 13));
      const bottomPad = Math.round(clamp(stripW * 0.22, 14, 30));
      const topPad = Math.round(clamp(stripW * 0.28, 16, 34));
      const dotR = clamp(stripW * 0.05, 3, 6);

      hexList.forEach((hex, i) => {
        const x = m.cardX + i * (stripW + gap);
        const y = swatchTop;
        const textColor = ExporterColorUtils.getContrastingTextColor(hex);
        const rgb = ExporterColorUtils.hexToRgb(hex);
        const hexY = showRgb
          ? y + swatchAreaH - bottomPad - rgbFont * 1.6
          : y + swatchAreaH - bottomPad;

        swatchesSvg += `
          <g>
            <rect x="${x}" y="${y}" width="${stripW}" height="${swatchAreaH}" rx="${radius}" fill="${hex}" />
            <circle cx="${x + stripW / 2}" cy="${y + topPad}" r="${dotR}" fill="${textColor}" />
            <text x="${x + stripW / 2}" y="${hexY}" fill="${textColor}" font-family="monospace" font-weight="700" font-size="${hexFont}" text-anchor="middle">${hex}</text>
            ${showRgb ? `<text x="${x + stripW / 2}" y="${y + swatchAreaH - bottomPad}" fill="${textColor}" fill-opacity="0.7" font-family="monospace" font-weight="500" font-size="${rgbFont}" text-anchor="middle">${rgb.r}, ${rgb.g}, ${rgb.b}</text>` : ''}
          </g>
        `;
      });
    } else if (layout === 'horizontal') {
      const gap = Math.max(6, Math.round(m.cardW * 0.008));
      const barH = (swatchAreaH - gap * (count - 1)) / count;
      const radius = Math.round(clamp(barH * 0.32, 8, 22));
      const hexFont = Math.round(clamp(Math.min(barH * 0.4, m.cardW * 0.017), 10, 22));
      const rgbFont = Math.round(clamp(barH * 0.26, 9, 14));
      const padX = Math.round(clamp(barH * 0.55, 14, 28));
      const showRgb = barH >= 36 && m.cardW >= 640;

      hexList.forEach((hex, i) => {
        const y = swatchTop + i * (barH + gap);
        const textColor = ExporterColorUtils.getContrastingTextColor(hex);
        const rgb = ExporterColorUtils.hexToRgb(hex);

        swatchesSvg += `
          <g>
            <rect x="${m.cardX}" y="${y}" width="${m.cardW}" height="${barH}" rx="${radius}" fill="${hex}" />
            <text x="${m.cardX + padX}" y="${y + barH / 2 + hexFont * 0.35}" fill="${textColor}" font-family="monospace" font-weight="700" font-size="${hexFont}" text-anchor="start">${hex}</text>
            ${showRgb ? `<text x="${m.cardX + m.cardW - padX}" y="${y + barH / 2 + rgbFont * 0.35}" fill="${textColor}" fill-opacity="0.7" font-family="monospace" font-weight="500" font-size="${rgbFont}" text-anchor="end">${rgb.r}, ${rgb.g}, ${rgb.b}</text>` : ''}
          </g>
        `;
      });
    } else {
      const gap = Math.round(clamp(m.minDim * 0.011, 8, 18));
      const maxTile = Math.round(m.minDim * 0.24);
      const grid = computeSquareGrid(m.cardX, swatchTop, m.cardW, swatchAreaH, count, gap, maxTile);
      const radius = Math.round(clamp(grid.size * 0.14, 10, 26));
      const hexFont = Math.round(clamp(grid.size * 0.12, 10, 22));

      hexList.forEach((hex, i) => {
        const row = Math.floor(i / grid.cols);
        const col = i % grid.cols;
        const itemsInRow = Math.min(grid.cols, count - row * grid.cols);
        const rowWidth = itemsInRow * grid.size + (itemsInRow - 1) * gap;
        const x = m.cardX + (m.cardW - rowWidth) / 2 + col * (grid.size + gap);
        const y = grid.y + row * (grid.size + gap);
        const textColor = ExporterColorUtils.getContrastingTextColor(hex);
        const label = grid.size >= 50
          ? `<text x="${x + grid.size / 2}" y="${y + grid.size / 2 + hexFont * 0.35}" fill="${textColor}" font-family="monospace" font-weight="700" font-size="${hexFont}" text-anchor="middle">${hex}</text>`
          : '';

        swatchesSvg += `
          <g>
            <rect x="${x}" y="${y}" width="${grid.size}" height="${grid.size}" rx="${radius}" fill="${hex}" />
            ${label}
          </g>
        `;
      });
    }

    const brandingSvg = includeBranding ? `
      ${hasLogo ? `<image href="${logoDataUrl}" xlink:href="${logoDataUrl}" x="${(width - m.logoW) / 2}" y="${m.logoTop}" width="${m.logoW}" height="${m.logoH}" />` : ''}
      <text x="${width / 2}" y="${m.taglineBaseline}" fill="#94A3B8" font-family="sans-serif" font-weight="600" font-size="${m.taglineFontSize}" text-anchor="middle">
        ${hasLogo ? '100% Client-Side Private Colour Extraction' : 'hue.tf • 100% Client-Side Private Colour Extraction'}
      </text>
    ` : '';

    return `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
        <rect width="${width}" height="${height}" fill="#080C14" />
        <text x="${m.cardX}" y="${m.cardY + m.titleFontSize}" fill="#FFFFFF" font-family="sans-serif" font-weight="bold" font-size="${m.titleFontSize}">${titleSvg}</text>
        <text x="${m.cardX}" y="${m.subtitleBaseline}" fill="#94A3B8" font-family="sans-serif" font-size="${m.subtitleFontSize}">${count} Curated Colours</text>
        ${swatchesSvg}
        ${brandingSvg}
      </svg>
    `.trim();
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Exporter;
} else {
  window.Exporter = Exporter;
}
