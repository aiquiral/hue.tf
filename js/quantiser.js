const QuantiserColorUtils = (typeof module !== 'undefined' && module.exports)
  ? require('./utils')
  : window.ColorUtils;

function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const Quantiser = {
  samplePixels(imageData, blockSize = 1, seed = 12345, maxSamples = 16000) {
    const { data, width, height } = imageData;
    const prng = mulberry32(seed);
    const samples = [];

    blockSize = Math.max(1, Math.round(blockSize));

    if (blockSize === 1) {
      const totalPixels = width * height;
      const step = Math.max(1, Math.floor(totalPixels / maxSamples));
      const startOffset = Math.floor(prng() * step);

      for (let i = startOffset; i < totalPixels; i += step) {
        const jitter = Math.floor((prng() - 0.5) * step);
        const pixelIdx = Math.max(0, Math.min(totalPixels - 1, i + jitter));
        const idx = pixelIdx * 4;

        if (data[idx + 3] < 128) continue;
        const x = pixelIdx % width;
        const y = Math.floor(pixelIdx / width);

        samples.push({
          rgb: [data[idx], data[idx + 1], data[idx + 2]],
          x: x / width,
          y: y / height
        });
        if (samples.length >= maxSamples) break;
      }
    } else {
      const offsetX = Math.floor(prng() * blockSize);
      const offsetY = Math.floor(prng() * blockSize);

      for (let y = offsetY; y < height && samples.length < maxSamples; y += blockSize) {
        for (let x = offsetX; x < width && samples.length < maxSamples; x += blockSize) {
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          for (let by = 0; by < blockSize && (y + by) < height; by++) {
            for (let bx = 0; bx < blockSize && (x + bx) < width; bx++) {
              const idx = ((y + by) * width + (x + bx)) * 4;
              if (data[idx + 3] >= 128) {
                sumR += data[idx];
                sumG += data[idx + 1];
                sumB += data[idx + 2];
                count++;
              }
            }
          }

          if (count > 0) {
            samples.push({
              rgb: [
                Math.round(sumR / count),
                Math.round(sumG / count),
                Math.round(sumB / count)
              ],
              x: (x + blockSize / 2) / width,
              y: (y + blockSize / 2) / height
            });
          }
        }
      }
    }

    return samples;
  },

  fallbackPalette(count) {
    const items = [];
    for (let i = 0; i < count; i++) {
      const rgb = QuantiserColorUtils.hslToRgb(Math.round((i * 360) / count), 65, 55);
      const channels = [rgb.r, rgb.g, rgb.b];
      items.push({
        hex: QuantiserColorUtils.rgbToHex(channels[0], channels[1], channels[2]),
        rgb: channels,
        x: (i + 1) / (count + 1),
        y: i % 2 === 0 ? 0.35 : 0.65
      });
    }
    return items;
  },

  medianCutBoxes(pixels, targetBoxes) {
    if (pixels.length === 0) return [];

    class VBox {
      constructor(colors) {
        this.colors = colors;
        this.calcBounds();
      }

      calcBounds() {
        let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
        for (const [r, g, b] of this.colors) {
          if (r < rmin) rmin = r; if (r > rmax) rmax = r;
          if (g < gmin) gmin = g; if (g > gmax) gmax = g;
          if (b < bmin) bmin = b; if (b > bmax) bmax = b;
        }
        this.rmin = rmin; this.rmax = rmax;
        this.gmin = gmin; this.gmax = gmax;
        this.bmin = bmin; this.bmax = bmax;
        this.rdiff = rmax - rmin;
        this.gdiff = gmax - gmin;
        this.bdiff = bmax - bmin;
        this.volume = (this.rdiff + 1) * (this.gdiff + 1) * (this.bdiff + 1);
        this.count = this.colors.length;
      }

      split() {
        if (this.colors.length <= 1) return [this];
        let channel = 0;
        let maxDiff = this.rdiff;
        if (this.gdiff > maxDiff) { channel = 1; maxDiff = this.gdiff; }
        if (this.bdiff > maxDiff) { channel = 2; }

        this.colors.sort((a, b) => a[channel] - b[channel]);
        const mid = Math.floor(this.colors.length / 2);

        return [new VBox(this.colors.slice(0, mid)), new VBox(this.colors.slice(mid))];
      }
    }

    const boxes = [new VBox(pixels)];

    while (boxes.length < targetBoxes) {
      let bestIdx = -1;
      let maxScore = -1;

      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].colors.length > 1) {
          const score = boxes[i].volume * Math.sqrt(boxes[i].count);
          if (score > maxScore) {
            maxScore = score;
            bestIdx = i;
          }
        }
      }

      if (bestIdx === -1) break;
      const [boxA, boxB] = boxes[bestIdx].split();
      boxes.splice(bestIdx, 1, boxA, boxB);
    }

    return boxes;
  },

  initCentroidsSeed(pixels, k, prng) {
    if (pixels.length === 0) return [];
    if (pixels.length <= k) return pixels.slice();

    const centroids = [];
    const firstIdx = Math.floor(prng() * pixels.length);
    centroids.push([...pixels[firstIdx]]);

    for (let c = 1; c < k; c++) {
      let totalDist = 0;
      const distances = new Float32Array(pixels.length);

      for (let i = 0; i < pixels.length; i++) {
        const [r, g, b] = pixels[i];
        let minDist = Infinity;
        for (let j = 0; j < centroids.length; j++) {
          const [cr, cg, cb] = centroids[j];
          const d = (r - cr) * (r - cr) + (g - cg) * (g - cg) + (b - cb) * (b - cb);
          if (d < minDist) minDist = d;
        }
        distances[i] = minDist;
        totalDist += minDist;
      }

      let threshold = prng() * totalDist;
      let chosen = pixels[0];
      for (let i = 0; i < pixels.length; i++) {
        threshold -= distances[i];
        if (threshold <= 0) {
          chosen = pixels[i];
          break;
        }
      }
      centroids.push([...chosen]);
    }

    return centroids;
  },

  getHybridCentroids(pixels, targetCount, seed) {
    const prng = mulberry32(seed);
    if (pixels.length < 50 || targetCount > pixels.length) {
      return this.initCentroidsSeed(pixels, targetCount, prng);
    }

    const boxes = this.medianCutBoxes(pixels, Math.min(pixels.length, targetCount * 2));
    const candidatePixels = boxes.map(box => {
      const idx = Math.floor(prng() * box.colors.length);
      return box.colors[idx];
    });

    return this.initCentroidsSeed(candidatePixels, targetCount, prng);
  },

  kMeansRefine(pixels, centroids, iterations = 6, seed = 12345) {
    if (pixels.length === 0 || centroids.length === 0) return centroids;
    const k = centroids.length;
    let currentCentroids = centroids.map(c => [...c]);
    const prng = mulberry32(seed);

    for (let iter = 0; iter < iterations; iter++) {
      const clusters = Array.from({ length: k }, () => []);

      for (let i = 0; i < pixels.length; i++) {
        const [r, g, b] = pixels[i];
        let minDist = Infinity;
        let closest = 0;

        for (let j = 0; j < k; j++) {
          const [cr, cg, cb] = currentCentroids[j];
          const dist = (r - cr) * (r - cr) + (g - cg) * (g - cg) + (b - cb) * (b - cb);
          if (dist < minDist) {
            minDist = dist;
            closest = j;
          }
        }
        clusters[closest].push(pixels[i]);
      }

      let shifted = false;
      for (let j = 0; j < k; j++) {
        if (clusters[j].length > 0) {
          let sumR = 0, sumG = 0, sumB = 0;
          for (let m = 0; m < clusters[j].length; m++) {
            sumR += clusters[j][m][0];
            sumG += clusters[j][m][1];
            sumB += clusters[j][m][2];
          }
          const newCentroid = [
            Math.round(sumR / clusters[j].length),
            Math.round(sumG / clusters[j].length),
            Math.round(sumB / clusters[j].length)
          ];
          if (newCentroid[0] !== currentCentroids[j][0] ||
              newCentroid[1] !== currentCentroids[j][1] ||
              newCentroid[2] !== currentCentroids[j][2]) {
            shifted = true;
          }
          currentCentroids[j] = newCentroid;
        } else {
          const randPixel = pixels[Math.floor(prng() * pixels.length)];
          currentCentroids[j] = [...randPixel];
          shifted = true;
        }
      }

      if (!shifted) break;
    }

    return currentCentroids;
  },

  // returns [{ hex, rgb: [r, g, b], x, y }], sorted by hue and lightness
  extractPalette(imageData, options = {}) {
    const colorCount = Math.max(2, Math.min(32, options.colorCount || 8));
    const seed = options.seed !== undefined ? options.seed : 42;
    const blockSize = Math.max(1, Math.min(24, options.blockSize || 1));

    const sampled = this.samplePixels(imageData, blockSize, seed);
    if (sampled.length === 0) {
      return this.fallbackPalette(colorCount);
    }

    const rawPixels = sampled.map(s => s.rgb);

    const initialCentroids = this.getHybridCentroids(rawPixels, colorCount, seed);
    const refinedCentroids = this.kMeansRefine(rawPixels, initialCentroids, 5, seed);

    while (refinedCentroids.length < colorCount) {
      let bestRgb = sampled[0].rgb;
      let bestDist = -1;
      for (let i = 0; i < sampled.length; i++) {
        const [r, g, b] = sampled[i].rgb;
        let minDist = Infinity;
        for (let j = 0; j < refinedCentroids.length; j++) {
          const [cr, cg, cb] = refinedCentroids[j];
          const d = (r - cr) * (r - cr) + (g - cg) * (g - cg) + (b - cb) * (b - cb);
          if (d < minDist) minDist = d;
        }
        if (minDist > bestDist) {
          bestDist = minDist;
          bestRgb = sampled[i].rgb;
        }
      }
      refinedCentroids.push([...bestRgb]);
    }

    // nearest sampled pixel gives each pin a real position in the image
    const paletteItems = refinedCentroids.map(([cr, cg, cb]) => {
      let minDist = Infinity;
      let bestX = 0.5, bestY = 0.5;

      for (let i = 0; i < sampled.length; i++) {
        const [r, g, b] = sampled[i].rgb;
        const d = (r - cr) * (r - cr) + (g - cg) * (g - cg) + (b - cb) * (b - cb);
        if (d < minDist) {
          minDist = d;
          bestX = sampled[i].x;
          bestY = sampled[i].y;
        }
      }

      return {
        hex: QuantiserColorUtils.rgbToHex(cr, cg, cb),
        rgb: [cr, cg, cb],
        x: Math.max(0.02, Math.min(0.98, bestX)),
        y: Math.max(0.02, Math.min(0.98, bestY))
      };
    });

    return this.sortPaletteItems(paletteItems);
  },

  sortPaletteItems(items) {
    return items.slice().sort((a, b) => {
      const rgbA = a.rgb || QuantiserColorUtils.hexToRgb(a.hex);
      const rgbB = b.rgb || QuantiserColorUtils.hexToRgb(b.hex);
      const hslA = QuantiserColorUtils.rgbToHsl(rgbA[0] ?? rgbA.r, rgbA[1] ?? rgbA.g, rgbA[2] ?? rgbA.b);
      const hslB = QuantiserColorUtils.rgbToHsl(rgbB[0] ?? rgbB.r, rgbB[1] ?? rgbB.g, rgbB[2] ?? rgbB.b);
      return (hslA.h - hslB.h) || (hslA.l - hslB.l);
    });
  },

  sortPalette(hexList) {
    return hexList.slice().sort((a, b) => {
      const rgbA = QuantiserColorUtils.hexToRgb(a);
      const rgbB = QuantiserColorUtils.hexToRgb(b);
      const hslA = QuantiserColorUtils.rgbToHsl(rgbA.r, rgbA.g, rgbA.b);
      const hslB = QuantiserColorUtils.rgbToHsl(rgbB.r, rgbB.g, rgbB.b);
      return (hslA.h - hslB.h) || (hslA.l - hslB.l);
    });
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Quantiser;
} else {
  window.Quantiser = Quantiser;
}
