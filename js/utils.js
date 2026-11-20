const ColorUtils = {
  hexToRgb(hex) {
    if (typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
    let clean = hex.replace('#', '').trim();
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    if (!/^[0-9A-Fa-f]{6}$/.test(clean)) return { r: 0, g: 0, b: 0 };
    const val = parseInt(clean, 16);
    return {
      r: (val >> 16) & 255,
      g: (val >> 8) & 255,
      b: val & 255
    };
  },

  rgbToHex(r, g, b) {
    const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  },

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0; // achromatic
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  },

  rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, v = max;
    const d = max - min;
    s = max === 0 ? 0 : d / max;

    if (max === min) {
      h = 0;
    } else {
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      v: Math.round(v * 100)
    };
  },

  // Relative luminance for WCAG 2.1
  getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  },

  // picks a dark or light label colour for contrast
  getContrastingTextColor(hex) {
    const { r, g, b } = this.hexToRgb(hex);
    const lum = this.getLuminance(r, g, b);
    return lum > 0.38 ? '#111827' : '#F9FAFB';
  },

  // RGB -> CIELAB, for perceptual distance
  rgbToLab(r, g, b) {
    let [lr, lg, lb] = [r, g, b].map(v => {
      v /= 255;
      return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
    });

    // Observer: 2°, Illuminant: D65
    let x = (lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375) / 0.95047;
    let y = (lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750) / 1.00000;
    let z = (lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041) / 1.08883;

    const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116);
    let fx = f(x), fy = f(y), fz = f(z);

    return {
      l: (116 * fy) - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz)
    };
  },

  // CIE76 colour difference
  deltaE(lab1, lab2) {
    const dl = lab1.l - lab2.l;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return Math.sqrt(dl * dl + da * da + db * db);
  },

  generateASE(paletteHexList, paletteName = 'hue.tf Palette') {
    const totalBlocks = 1 + paletteHexList.length + 1; // group start + entries + group end
    const chunks = [];

    // big-endian writers
    const writeUInt16 = (val) => [ (val >> 8) & 255, val & 255 ];
    const writeUInt32 = (val) => [ (val >> 24) & 255, (val >> 16) & 255, (val >> 8) & 255, val & 255 ];
    const writeFloat32 = (val) => {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setFloat32(0, val, false);
      return Array.from(new Uint8Array(buf));
    };
    const writeUnicodeString = (str) => {
      const bytes = writeUInt16(str.length + 1);
      for (let i = 0; i < str.length; i++) {
        bytes.push(...writeUInt16(str.charCodeAt(i)));
      }
      bytes.push(0, 0); // null terminator
      return bytes;
    };

    const bytes = [
      0x41, 0x53, 0x45, 0x46, // 'ASEF'
      0x00, 0x01, 0x00, 0x00, // Version 1.0
      ...writeUInt32(totalBlocks)
    ];

    const groupNameBytes = writeUnicodeString(paletteName);
    bytes.push(0xC0, 0x01); // block type Group Start
    bytes.push(...writeUInt32(groupNameBytes.length));
    bytes.push(...groupNameBytes);

    for (const hex of paletteHexList) {
      const rgb = this.hexToRgb(hex);
      const colorNameBytes = writeUnicodeString(hex);
      const colorData = [
        ...colorNameBytes,
        0x52, 0x47, 0x42, 0x20, // 'RGB '
        ...writeFloat32(rgb.r / 255),
        ...writeFloat32(rgb.g / 255),
        ...writeFloat32(rgb.b / 255),
        0x00, 0x02 // Swatch mode: 0=Global, 1=Spot, 2=Process
      ];
      bytes.push(0x00, 0x01); // Color entry
      bytes.push(...writeUInt32(colorData.length));
      bytes.push(...colorData);
    }

    bytes.push(0xC0, 0x02, 0x00, 0x00, 0x00, 0x00); // group end

    return new Uint8Array(bytes);
  }
};

// works in node too, for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColorUtils;
} else {
  window.ColorUtils = ColorUtils;
}

ColorUtils.hslToRgb = function(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  };
};
