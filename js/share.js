const ShareColorUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./utils')
  : window.ColorUtils;

const PaletteShare = {
  // 3 bytes per colour, base64url - 32 colours fit in 128 chars
  encodeBinary(hexList) {
    if (!hexList || hexList.length === 0) return '';
    const list = hexList.slice(0, 32);
    const bytes = new Uint8Array(list.length * 3);
    for (let i = 0; i < list.length; i++) {
      const rgb = ShareColorUtils.hexToRgb(list[i]);
      bytes[i * 3]     = rgb.r;
      bytes[i * 3 + 1] = rgb.g;
      bytes[i * 3 + 2] = rgb.b;
    }

    let binaryStr = '';
    for (let i = 0; i < bytes.length; i++) {
      binaryStr += String.fromCharCode(bytes[i]);
    }

    // base64url (no +, / or =)
    return btoa(binaryStr)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  },

  decodeBinary(base64UrlStr) {
    try {
      let b64 = base64UrlStr.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binaryStr = atob(b64);
      const colors = [];
      for (let i = 0; i < binaryStr.length; i += 3) {
        if (i + 2 >= binaryStr.length) break;
        const r = binaryStr.charCodeAt(i);
        const g = binaryStr.charCodeAt(i + 1);
        const b = binaryStr.charCodeAt(i + 2);
        colors.push(ShareColorUtils.rgbToHex(r, g, b));
        if (colors.length >= 32) break;
      }
      return colors;
    } catch (e) {
      console.error('Failed to decode binary palette:', e);
      return null;
    }
  },

  // readable fallback: #RRGGBB-#RRGGBB-...
  encodeDelimited(hexList) {
    return hexList.slice(0, 32).map(h => h.replace('#', '').toUpperCase()).join('-');
  },

  decodeDelimited(str) {
    const parts = str.split('-').map(s => s.trim().replace('#', ''));
    const valid = parts.filter(p => /^[0-9A-Fa-f]{6}$/.test(p));
    if (valid.length === 0) return null;
    return valid.slice(0, 32).map(p => `#${p.toUpperCase()}`);
  },

  getShareUrl(hexList, mode = 'binary') {
    const baseUrl = window.location.href.split('#')[0];
    if (mode === 'binary') {
      const token = this.encodeBinary(hexList);
      return `${baseUrl}#p=${token}`;
    } else {
      const token = this.encodeDelimited(hexList);
      return `${baseUrl}#${token}`;
    }
  },

  readFromCurrentUrl() {
    if (typeof window === 'undefined' || !window.location.hash) return null;
    const hash = window.location.hash.substring(1); // strip leading '#'
    if (!hash) return null;

    if (hash.startsWith('p=')) {
      const b64 = hash.substring(2);
      return this.decodeBinary(b64);
    }

    return this.decodeDelimited(hash);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PaletteShare;
} else {
  window.PaletteShare = PaletteShare;
}
