(function () {
  'use strict';

  const state = {
    swatches: [], // { hex, rgb, x, y, id }
    palette: [],  // hex strings, kept for backcompat
    sourceImage: null,
    imageFileName: 'palette',
    cardTitle: 'Harmonised Palette',
    colorCount: 8,
    seed: 42,
    blockSize: 1,
    editMode: 'hex', // 'hex' | 'rgb' | 'hsl'
    includeImageInCard: false,
    cardBgMode: 'blur',
    cardBlurRadius: 30,
    includeBranding: true,
    cardAspectRatio: '1:1',
    cardSwatchLayout: 'vertical',
    currentCodeFormat: 'css',
    cachedCardBlob: null
  };

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const canvasWarning = document.getElementById('canvas-warning');
  const workspace = document.getElementById('workspace');
  const previewContainer = document.getElementById('preview-container');
  const imageCanvas = document.getElementById('image-canvas');
  const pinsOverlay = document.getElementById('pins-overlay');
  const swatchesGrid = document.getElementById('swatches-grid');

  const magnifierLoupe = document.getElementById('magnifier-loupe');
  const magnifierCanvas = document.getElementById('magnifier-canvas');
  const magnifierCtx = magnifierCanvas.getContext('2d');
  const magnifierBadge = document.getElementById('magnifier-badge');

  const sliderColorCount = document.getElementById('slider-color-count');
  const labelColorCount = document.getElementById('label-color-count');
  const sliderSeed = document.getElementById('slider-seed');
  const labelSeed = document.getElementById('label-seed');
  const btnRerollSeed = document.getElementById('btn-reroll-seed');
  const sliderBlockSize = document.getElementById('slider-block-size');
  const labelBlockSize = document.getElementById('label-block-size');

  const btnExport = document.getElementById('btn-export');
  const btnShare = document.getElementById('btn-share');
  const btnAddColor = document.getElementById('btn-add-color');
  const btnSort = document.getElementById('btn-sort');
  const btnChangeImage = document.getElementById('btn-change-image');
  const btnScreenEyedropper = document.getElementById('btn-screen-eyedropper');

  const exportModal = document.getElementById('export-modal');
  const btnCloseExport = document.getElementById('btn-close-export');
  const shareModal = document.getElementById('share-modal');
  const btnCloseShare = document.getElementById('btn-close-share');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');

  const exportCardImg = document.getElementById('export-card-img');
  const inputCardTitle = document.getElementById('input-card-title');
  const selectBgMode = document.getElementById('select-bg-mode');
  const sliderCardBlur = document.getElementById('slider-card-blur');
  const blurSliderGroup = document.getElementById('blur-slider-group');
  const checkIncludeImage = document.getElementById('check-include-image');
  const checkBranding = document.getElementById('check-branding');
  const selectAspectRatio = document.getElementById('select-aspect-ratio');
  const selectSwatchLayout = document.getElementById('select-swatch-layout');
  const swatchLayoutHint = document.getElementById('swatch-layout-hint');
  const btnDownloadPng = document.getElementById('btn-download-png');
  const btnDownloadSvg = document.getElementById('btn-download-svg');
  const btnDownloadAse = document.getElementById('btn-download-ase');
  const btnWebShare = document.getElementById('btn-web-share');
  const codeOutput = document.getElementById('code-output');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnDownloadCodeFile = document.getElementById('btn-download-code-file');

  const shareLinkInput = document.getElementById('share-link-input');
  const btnCopyShareLink = document.getElementById('btn-copy-share-link');
  const shareLengthBadge = document.getElementById('share-length-badge');

  let idCounter = 1;
  let animateNextRender = true; // next render plays the staggered entrance animation
  let previewTimer = null;
  let previewVersion = 0;
  let previewUrl = null;
  let canvasReadBlocked = false;
  let stripLayoutBeforeFallback = null;

  function init() {
    setupEventListeners();
    setupMagnifierLoupe();
    setupEyedropperSupport();
    setupPinsDragging();
    setupPreviewGeometry();
    updateExportSizeLabel();
    checkCanvasReadback();

    const sharedPalette = PaletteShare.readFromCurrentUrl();
    if (sharedPalette && sharedPalette.length >= 2) {
      const initialPalette = sharedPalette.slice(0, 32);
      state.palette = initialPalette;
      state.swatches = initialPalette.map((hex, i) => ({
        id: `swatch-${idCounter++}`,
        hex,
        rgb: ColorUtils.hexToRgb(hex),
        x: (i + 1) / (initialPalette.length + 1),
        y: 0.5
      }));
      state.colorCount = initialPalette.length;
      sliderColorCount.value = state.colorCount;
      labelColorCount.textContent = `${state.colorCount} colours`;
      showWorkspace();
      renderSwatches();
      showToast('Loaded shared palette from URL!');
    }
  }

  function setupEyedropperSupport() {
    if ('EyeDropper' in window) {
      btnScreenEyedropper.style.display = 'inline-flex';
    }
  }

  function checkCanvasReadback() {
    let readable = false;

    try {
      const size = 16;
      const half = size / 2;
      const probe = document.createElement('canvas');
      probe.width = size;
      probe.height = size;
      const ctx = probe.getContext('2d');

      if (ctx) {
        ctx.fillStyle = '#FF0000';
        ctx.fillRect(0, 0, half, half);
        ctx.fillStyle = '#00FF00';
        ctx.fillRect(half, 0, half, half);
        ctx.fillStyle = '#0000FF';
        ctx.fillRect(0, half, half, half);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(half, half, half, half);

        const pixels = ctx.getImageData(0, 0, size, size).data;
        const tolerance = 16;
        readable = true;

        for (let y = 0; y < size && readable; y++) {
          for (let x = 0; x < size; x++) {
            const expected = x < half
              ? (y < half ? [255, 0, 0, 255] : [0, 0, 255, 255])
              : (y < half ? [0, 255, 0, 255] : [255, 255, 255, 255]);
            const index = (y * size + x) * 4;

            for (let channel = 0; channel < 4; channel++) {
              if (Math.abs(pixels[index + channel] - expected[channel]) > tolerance) {
                readable = false;
                break;
              }
            }

            if (!readable) break;
          }
        }
      }
    } catch (err) {
      readable = false;
    }

    canvasWarning.hidden = readable;
  }

  function setupMagnifierLoupe() {
    magnifierCtx.imageSmoothingEnabled = false;

    imageCanvas.addEventListener('mouseenter', () => {
      if (!isDraggingPin) magnifierLoupe.classList.add('active');
    });

    imageCanvas.addEventListener('mouseleave', () => {
      magnifierLoupe.classList.remove('active');
    });

    imageCanvas.addEventListener('mousemove', (e) => {
      if (!isDraggingPin) updateLoupePosition(e);
    });
  }

  function setupPreviewGeometry() {
    window.addEventListener('resize', syncPreviewGeometry);
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(syncPreviewGeometry);
      observer.observe(previewContainer);
      observer.observe(imageCanvas);
    }
  }

  function syncPreviewGeometry() {
    if (!state.sourceImage) return;
    const canvasRect = imageCanvas.getBoundingClientRect();
    const containerRect = previewContainer.getBoundingClientRect();
    pinsOverlay.style.left = `${canvasRect.left - containerRect.left - previewContainer.clientLeft}px`;
    pinsOverlay.style.top = `${canvasRect.top - containerRect.top - previewContainer.clientTop}px`;
    pinsOverlay.style.width = `${canvasRect.width}px`;
    pinsOverlay.style.height = `${canvasRect.height}px`;
  }

  function readCanvasPixel(canvasX, canvasY) {
    if (canvasReadBlocked) return null;
    try {
      return imageCanvas.getContext('2d').getImageData(canvasX, canvasY, 1, 1).data;
    } catch (err) {
      canvasReadBlocked = true;
      showToast('This image cannot be sampled pixel-by-pixel');
      return null;
    }
  }

  function updateLoupePosition(e) {
    const rect = imageCanvas.getBoundingClientRect();
    const containerRect = previewContainer.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    magnifierLoupe.style.left = `${rect.left - containerRect.left - previewContainer.clientLeft + mouseX}px`;
    magnifierLoupe.style.top = `${rect.top - containerRect.top - previewContainer.clientTop + mouseY}px`;

    const scaleX = imageCanvas.width / rect.width;
    const scaleY = imageCanvas.height / rect.height;
    const canvasX = Math.floor(mouseX * scaleX);
    const canvasY = Math.floor(mouseY * scaleY);

    const patchSize = 11;
    const halfPatch = Math.floor(patchSize / 2);
    const srcX = Math.max(0, Math.min(imageCanvas.width - patchSize, canvasX - halfPatch));
    const srcY = Math.max(0, Math.min(imageCanvas.height - patchSize, canvasY - halfPatch));

    magnifierCtx.clearRect(0, 0, 130, 130);
    magnifierCtx.drawImage(
      imageCanvas,
      srcX, srcY, patchSize, patchSize,
      0, 0, 130, 130
    );

    // grid lines
    const cellSize = 130 / patchSize;
    magnifierCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    magnifierCtx.lineWidth = 1;
    for (let i = 0; i <= patchSize; i++) {
      magnifierCtx.beginPath();
      magnifierCtx.moveTo(i * cellSize, 0);
      magnifierCtx.lineTo(i * cellSize, 130);
      magnifierCtx.stroke();

      magnifierCtx.beginPath();
      magnifierCtx.moveTo(0, i * cellSize);
      magnifierCtx.lineTo(130, i * cellSize);
      magnifierCtx.stroke();
    }

    const pixel = readCanvasPixel(canvasX, canvasY);
    if (!pixel) return;
    const hex = ColorUtils.rgbToHex(pixel[0], pixel[1], pixel[2]);
    magnifierBadge.textContent = hex;
    magnifierBadge.style.backgroundColor = hex;
    magnifierBadge.style.color = ColorUtils.getContrastingTextColor(hex);
  }

  let isDraggingPin = false;
  let activePinIndex = null;

  function renderColorPins() {
    pinsOverlay.innerHTML = '';
    if (!state.sourceImage) return;

    state.swatches.forEach((swatch, index) => {
      const pin = document.createElement('div');
      pin.className = 'color-pin';
      pin.dataset.index = index;
      pin.style.left = `${swatch.x * 100}%`;
      pin.style.top = `${swatch.y * 100}%`;
      pin.style.backgroundColor = swatch.hex;
      pin.title = `Swatch ${index + 1}: ${swatch.hex} (Drag to sample new area)`;

      pin.innerHTML = `<span class="pin-inner-dot"></span>`;

      pin.addEventListener('mouseenter', () => {
        const matchingCard = swatchesGrid.children[index];
        if (matchingCard) matchingCard.classList.add('active-pin-hover');
      });
      pin.addEventListener('mouseleave', () => {
        const matchingCard = swatchesGrid.children[index];
        if (matchingCard) matchingCard.classList.remove('active-pin-hover');
      });

      pinsOverlay.appendChild(pin);
    });
  }

  function setupPinsDragging() {
    previewContainer.addEventListener('pointerdown', (e) => {
      const pin = e.target.closest('.color-pin');
      if (pin) {
        isDraggingPin = true;
        activePinIndex = parseInt(pin.dataset.index, 10);
        pin.setPointerCapture(e.pointerId);
        magnifierLoupe.classList.remove('active');
        e.preventDefault();
      }
    });

    previewContainer.addEventListener('pointermove', (e) => {
      if (!isDraggingPin || activePinIndex === null) return;
      const rect = imageCanvas.getBoundingClientRect();
      const normX = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / rect.height));
      const canvasX = Math.floor(normX * imageCanvas.width);
      const canvasY = Math.floor(normY * imageCanvas.height);
      const pixel = readCanvasPixel(canvasX, canvasY);
      if (!pixel) return;

      state.swatches[activePinIndex].x = normX;
      state.swatches[activePinIndex].y = normY;

      const newHex = ColorUtils.rgbToHex(pixel[0], pixel[1], pixel[2]);

      state.swatches[activePinIndex].hex = newHex;
      state.swatches[activePinIndex].rgb = [pixel[0], pixel[1], pixel[2]];
      state.palette[activePinIndex] = newHex;

      const pinEl = pinsOverlay.children[activePinIndex];
      if (pinEl) {
        pinEl.style.left = `${normX * 100}%`;
        pinEl.style.top = `${normY * 100}%`;
        pinEl.style.backgroundColor = newHex;
      }

      updateCardLive(activePinIndex);
    });

    const stopDragging = (e) => {
      if (isDraggingPin) {
        isDraggingPin = false;
        activePinIndex = null;
        renderSwatches();
      }
    };

    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);
  }

  function updateCardLive(index) {
    const card = swatchesGrid.children[index];
    if (!card) return;
    const swatch = state.swatches[index];
    const colorBox = card.querySelector('.swatch-color-box');
    const colorPicker = card.querySelector('.swatch-color-input');
    const rgb = ColorUtils.hexToRgb(swatch.hex);
    const hsl = ColorUtils.rgbToHsl(rgb.r, rgb.g, rgb.b);

    if (colorBox) colorBox.style.backgroundColor = swatch.hex;
    if (colorPicker) colorPicker.value = swatch.hex;
    card.style.setProperty('--swatch-color', swatch.hex);

    if (state.editMode === 'hex') {
      const hexInput = card.querySelector('.swatch-hex-input');
      if (hexInput && document.activeElement !== hexInput) {
        hexInput.value = swatch.hex.replace('#', '');
      }
    } else if (state.editMode === 'rgb') {
      const inputs = card.querySelectorAll('.tri-channel-input');
      if (inputs.length === 3) {
        if (document.activeElement !== inputs[0]) inputs[0].value = rgb.r;
        if (document.activeElement !== inputs[1]) inputs[1].value = rgb.g;
        if (document.activeElement !== inputs[2]) inputs[2].value = rgb.b;
      }
    } else if (state.editMode === 'hsl') {
      const inputs = card.querySelectorAll('.tri-channel-input');
      if (inputs.length === 3) {
        if (document.activeElement !== inputs[0]) inputs[0].value = hsl.h;
        if (document.activeElement !== inputs[1]) inputs[1].value = hsl.s;
        if (document.activeElement !== inputs[2]) inputs[2].value = hsl.l;
      }
    }

    updateCardSubChips(card, swatch.hex);
  }

  function updateCardSubChips(card, hex) {
    const rgb = ColorUtils.hexToRgb(hex);
    const hsl = ColorUtils.rgbToHsl(rgb.r, rgb.g, rgb.b);
    const chips = card.querySelectorAll('.badge-chip span:last-child');
    if (chips.length >= 2) {
      if (state.editMode === 'hex') {
        chips[0].textContent = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
        chips[1].textContent = `${hsl.h}°, ${hsl.s}%, ${hsl.l}%`;
      } else if (state.editMode === 'rgb') {
        chips[0].textContent = hex;
        chips[1].textContent = `${hsl.h}°, ${hsl.s}%, ${hsl.l}%`;
      } else if (state.editMode === 'hsl') {
        chips[0].textContent = hex;
        chips[1].textContent = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
      }
    }
  }

  function setupEventListeners() {
    dropzone.addEventListener('click', (e) => {
      if (!e.target.closest('.sample-tag')) fileInput.click();
    });
    fileInput.addEventListener('change', handleFileSelect);

    ['dragenter', 'dragover'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(name => {
      dropzone.addEventListener(name, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    window.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types;
      if (types && Array.from(types).includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      if (exportModal.classList.contains('active') || shareModal.classList.contains('active')) return;
      if (files[0].type.startsWith('image/')) loadImageFile(files[0]);
    });

    window.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) loadImageFile(file);
          break;
        }
      }
    });

    document.querySelectorAll('.sample-tag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        loadSampleImage(tag.dataset.sample);
      });
    });

    btnChangeImage.addEventListener('click', () => fileInput.click());

    document.querySelectorAll('.segmented-control .seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.segmented-control .seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.editMode = btn.dataset.mode;
        renderSwatches();
        showToast(`Switched edit mode to ${state.editMode.toUpperCase()}`);
      });
    });

    sliderColorCount.addEventListener('input', (e) => {
      state.colorCount = parseInt(e.target.value, 10);
      labelColorCount.textContent = `${state.colorCount} colours`;
      recalculatePalette();
    });

    sliderSeed.addEventListener('input', (e) => {
      state.seed = parseInt(e.target.value, 10);
      labelSeed.textContent = `Seed: ${state.seed}`;
      recalculatePalette();
    });

    btnRerollSeed.addEventListener('click', () => {
      state.seed = Math.floor(Math.random() * 9999) + 1;
      sliderSeed.value = state.seed;
      labelSeed.textContent = `Seed: ${state.seed}`;
      recalculatePalette();
    });

    sliderBlockSize.addEventListener('input', (e) => {
      state.blockSize = parseInt(e.target.value, 10);
      labelBlockSize.textContent = state.blockSize === 1 ? '1px (Single Pixel)' : `${state.blockSize}px Area`;
      recalculatePalette();
    });

    imageCanvas.addEventListener('click', (e) => {
      if (isDraggingPin) return;
      const rect = imageCanvas.getBoundingClientRect();
      const normX = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / rect.height));

      const canvasX = Math.floor(normX * imageCanvas.width);
      const canvasY = Math.floor(normY * imageCanvas.height);
      const pixel = readCanvasPixel(canvasX, canvasY);
      if (!pixel) return;
      const hex = ColorUtils.rgbToHex(pixel[0], pixel[1], pixel[2]);

      addColorPinAt(hex, normX, normY);
      showToast(`Sampled ${hex} into palette!`);
    });

    btnScreenEyedropper.addEventListener('click', async () => {
      if (!('EyeDropper' in window)) return;
      try {
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        if (result && result.sRGBHex) {
          addColorPinAt(result.sRGBHex.toUpperCase(), 0.5, 0.5);
        }
      } catch (err) {}
    });

    btnAddColor.addEventListener('click', () => {
      if (state.swatches.length >= 32) {
        showToast('Maximum of 32 colours reached');
        return;
      }
      const randomColor = ColorUtils.rgbToHex(
        Math.floor(Math.random() * 200) + 30,
        Math.floor(Math.random() * 200) + 30,
        Math.floor(Math.random() * 200) + 30
      );
      addColorPinAt(randomColor, Math.random() * 0.8 + 0.1, Math.random() * 0.8 + 0.1);
    });

    btnSort.addEventListener('click', () => {
      const sorted = Quantiser.sortPaletteItems(state.swatches);
      animateFlipTransition(sorted);
      showToast('Palette sorted harmoniously');
    });

    btnExport.addEventListener('click', openExportModal);
    btnCloseExport.addEventListener('click', () => exportModal.classList.remove('active'));
    exportModal.addEventListener('click', (e) => {
      if (e.target === exportModal) exportModal.classList.remove('active');
    });

    inputCardTitle.addEventListener('input', (e) => {
      state.cardTitle = e.target.value.trim() || 'Harmonised Palette';
      scheduleExportCardPreview();
    });

    btnShare.addEventListener('click', openShareModal);
    btnCloseShare.addEventListener('click', () => shareModal.classList.remove('active'));
    shareModal.addEventListener('click', (e) => {
      if (e.target === shareModal) shareModal.classList.remove('active');
    });

    btnCopyShareLink.addEventListener('click', () => {
      copyText(shareLinkInput.value, 'Share link copied to clipboard!');
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).style.display = 'block';
      });
    });

    document.querySelectorAll('.format-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.format-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.currentCodeFormat = pill.dataset.fmt;
        updateCodeExport();
      });
    });

    btnCopyCode.addEventListener('click', () => {
      copyText(codeOutput.textContent, 'Code copied to clipboard!');
    });

    btnDownloadCodeFile.addEventListener('click', handleCodeDownload);
    btnDownloadAse.addEventListener('click', () => {
      Exporter.downloadASE(state.palette, `${state.imageFileName}-palette.ase`);
      showToast('Downloaded .ASE swatch file!');
    });

    selectAspectRatio.addEventListener('change', (e) => {
      state.cardAspectRatio = e.target.value;
      updateExportSizeLabel();
      updateExportCardPreview();
    });
    selectSwatchLayout.addEventListener('change', (e) => {
      state.cardSwatchLayout = e.target.value;
      updateExportCardPreview();
    });
    selectBgMode.addEventListener('change', (e) => {
      state.cardBgMode = e.target.value;
      blurSliderGroup.style.display = state.cardBgMode === 'blur' ? 'flex' : 'none';
      updateExportCardPreview();
    });
    sliderCardBlur.addEventListener('input', (e) => {
      state.cardBlurRadius = parseInt(e.target.value, 10);
      scheduleExportCardPreview();
    });
    checkIncludeImage.addEventListener('change', (e) => {
      state.includeImageInCard = e.target.checked;
      updateExportCardPreview();
    });
    checkBranding.addEventListener('change', (e) => {
      state.includeBranding = e.target.checked;
      updateExportCardPreview();
    });

    btnDownloadPng.addEventListener('click', () => {
      if (!state.cachedCardBlob) {
        showToast('Preview is still rendering');
        return;
      }
      Exporter.downloadBlob(state.cachedCardBlob, `${state.imageFileName}-palette.png`);
      showToast('High-Res PNG downloaded!');
    });

    btnDownloadSvg.addEventListener('click', async () => {
      try {
        const svg = await Exporter.generateSvgCard({
          hexList: state.palette,
          title: state.cardTitle || `Palette: ${state.imageFileName}`,
          includeBranding: state.includeBranding,
          aspectRatio: state.cardAspectRatio,
          swatchLayout: state.cardSwatchLayout
        });
        Exporter.downloadText(svg, `${state.imageFileName}-palette.svg`, 'image/svg+xml');
        showToast('Vector SVG downloaded!');
      } catch (err) {
        showToast('Could not generate SVG card');
      }
    });

    if (navigator.share) {
      btnWebShare.style.display = 'inline-flex';
      btnWebShare.addEventListener('click', async () => {
        if (!state.cachedCardBlob) {
          showToast('Preview is still rendering');
          return;
        }
        const file = new File([state.cachedCardBlob], `${state.imageFileName}-palette.png`, { type: 'image/png' });
        const shareUrl = PaletteShare.getShareUrl(state.palette, 'binary');
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: state.cardTitle,
              text: `Check out this colour palette: ${shareUrl}`,
              files: [file]
            });
          } else {
            await navigator.share({
              title: state.cardTitle,
              url: shareUrl
            });
          }
        } catch (err) {}
      });
    }
  }

  function addColorPinAt(hex, x, y) {
    if (state.swatches.length >= 32) {
      showToast('Maximum of 32 colours reached');
      return;
    }
    const newSwatch = {
      id: `swatch-${idCounter++}`,
      hex,
      rgb: ColorUtils.hexToRgb(hex),
      x,
      y
    };
    state.swatches.push(newSwatch);
    state.palette = state.swatches.map(s => s.hex);
    state.colorCount = state.swatches.length;
    sliderColorCount.value = state.colorCount;
    labelColorCount.textContent = `${state.colorCount} colours`;

    animateNextRender = true;
    renderSwatches();
    renderColorPins();
  }

  // FLIP - snap cards back to their old spots, then transition to the new ones
  function animateFlipTransition(newSwatches) {
    const existingCards = Array.from(swatchesGrid.children);
    const firstPositions = new Map();

    existingCards.forEach(card => {
      const id = card.dataset.id;
      if (id) firstPositions.set(id, card.getBoundingClientRect());
    });

    state.swatches = newSwatches;
    state.palette = state.swatches.map(s => s.hex);
    renderSwatches();
    renderColorPins();

    const newCards = Array.from(swatchesGrid.children);
    newCards.forEach(card => {
      const id = card.dataset.id;
      if (id && firstPositions.has(id)) {
        const first = firstPositions.get(id);
        const last = card.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;

        if (deltaX !== 0 || deltaY !== 0) {
          card.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
          card.style.transition = 'none';
          void card.offsetWidth;

          requestAnimationFrame(() => {
            card.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
            card.style.transform = '';
          });
        }
      }
    });
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadImageFile(file);
  }

  function loadImageFile(file) {
    const fileName = file.name.replace(/\.[^/.]+$/, '');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        if (!img.width || !img.height) {
          showToast('This image has no intrinsic size');
          return;
        }
        state.imageFileName = fileName;
        state.cardTitle = `Palette: ${fileName}`;
        inputCardTitle.value = state.cardTitle;
        state.sourceImage = img;
        state.cachedCardBlob = null;
        previewVersion++;
        clearTimeout(previewTimer);
        showWorkspace();
        displayImageOnCanvas(img);
        recalculatePalette();
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('Could not load that image');
    };
    img.src = url;
  }

  function displayImageOnCanvas(img) {
    if (!img.width || !img.height) {
      showToast('This image has no intrinsic size');
      return;
    }
    canvasReadBlocked = false;
    const maxDim = 850;
    let w = img.width, h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    imageCanvas.width = w;
    imageCanvas.height = h;
    const ctx = imageCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    syncPreviewGeometry();
  }

  function showWorkspace() {
    dropzone.style.display = 'none';
    workspace.style.display = 'grid';
    requestAnimationFrame(syncPreviewGeometry);
  }

  function recalculatePalette() {
    if (!state.sourceImage) {
      renderSwatches();
      return;
    }
    if (!state.sourceImage.width || !state.sourceImage.height) return;

    const offscreen = document.createElement('canvas');
    const targetW = 220;
    const targetH = Math.max(1, Math.round((state.sourceImage.height * targetW) / state.sourceImage.width));
    offscreen.width = targetW;
    offscreen.height = targetH;
    const ctx = offscreen.getContext('2d');
    ctx.drawImage(state.sourceImage, 0, 0, targetW, targetH);

    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, targetW, targetH);
    } catch (err) {
      canvasReadBlocked = true;
      showToast('This image cannot be sampled pixel-by-pixel');
      return;
    }

    const extracted = Quantiser.extractPalette(imgData, {
      colorCount: state.colorCount,
      seed: state.seed,
      blockSize: state.blockSize
    });

    state.swatches = extracted.map(item => ({
      id: `swatch-${idCounter++}`,
      hex: item.hex,
      rgb: item.rgb || ColorUtils.hexToRgb(item.hex),
      x: item.x,
      y: item.y
    }));
    state.palette = state.swatches.map(s => s.hex);
    state.colorCount = state.swatches.length;
    sliderColorCount.value = state.colorCount;
    labelColorCount.textContent = `${state.colorCount} colours`;

    animateNextRender = true;
    renderSwatches();
    renderColorPins();
  }

  function renderSwatches() {
    const hasPalette = state.swatches.length > 0;
    btnExport.disabled = !hasPalette;
    btnShare.disabled = !hasPalette;
    swatchesGrid.innerHTML = '';
    swatchesGrid.classList.toggle('animate-in', animateNextRender);

    state.swatches.forEach((swatch, index) => {
      const card = document.createElement('div');
      card.className = 'swatch-card';
      card.draggable = true;
      card.dataset.index = index;
      card.dataset.id = swatch.id;
      card.dataset.hex = swatch.hex;

      const rgb = ColorUtils.hexToRgb(swatch.hex);
      const hsl = ColorUtils.rgbToHsl(rgb.r, rgb.g, rgb.b);
      const rawHex = swatch.hex.replace('#', '');

      let primaryInputHtml = '';
      let secondaryChipsHtml = '';

      if (state.editMode === 'hex') {
        primaryInputHtml = `
          <div class="swatch-hex-input-wrap">
            <span class="hex-hash-prefix">#</span>
            <input type="text" class="swatch-hex-input" value="${rawHex}" maxlength="7" spellcheck="false" title="Edit Hex code">
            <button class="btn-copy-mini btn-copy-hex" title="Copy HEX">📋</button>
          </div>
        `;
        secondaryChipsHtml = `
          <div class="badge-chip"><span>RGB</span> <span>${rgb.r}, ${rgb.g}, ${rgb.b}</span></div>
          <div class="badge-chip"><span>HSL</span> <span>${hsl.h}°, ${hsl.s}%, ${hsl.l}%</span></div>
        `;
      } else if (state.editMode === 'rgb') {
        primaryInputHtml = `
          <div class="tri-input-wrap">
            <input type="number" class="tri-channel-input" data-channel="r" min="0" max="255" value="${rgb.r}" title="Red (0-255)">
            <input type="number" class="tri-channel-input" data-channel="g" min="0" max="255" value="${rgb.g}" title="Green (0-255)">
            <input type="number" class="tri-channel-input" data-channel="b" min="0" max="255" value="${rgb.b}" title="Blue (0-255)">
          </div>
        `;
        secondaryChipsHtml = `
          <div class="badge-chip"><span>HEX</span> <span>${swatch.hex}</span></div>
          <div class="badge-chip"><span>HSL</span> <span>${hsl.h}°, ${hsl.s}%, ${hsl.l}%</span></div>
        `;
      } else if (state.editMode === 'hsl') {
        primaryInputHtml = `
          <div class="tri-input-wrap">
            <input type="number" class="tri-channel-input" data-channel="h" min="0" max="360" value="${hsl.h}" title="Hue (0-360)">
            <input type="number" class="tri-channel-input" data-channel="s" min="0" max="100" value="${hsl.s}" title="Saturation (0-100%)">
            <input type="number" class="tri-channel-input" data-channel="l" min="0" max="100" value="${hsl.l}" title="Lightness (0-100%)">
          </div>
        `;
        secondaryChipsHtml = `
          <div class="badge-chip"><span>HEX</span> <span>${swatch.hex}</span></div>
          <div class="badge-chip"><span>RGB</span> <span>${rgb.r}, ${rgb.g}, ${rgb.b}</span></div>
        `;
      }

      card.innerHTML = `
        <div class="swatch-color-box" style="background-color: ${swatch.hex};">
          <span class="swatch-index-badge">${index + 1}</span>
          <input type="color" class="swatch-color-input" value="${swatch.hex}" title="Click to open colour picker">
          <div class="swatch-actions">
            <button class="swatch-btn btn-delete" title="Delete swatch" data-index="${index}">✕</button>
          </div>
        </div>
        <div class="swatch-info">
          ${primaryInputHtml}
          <div class="swatch-badges">
            ${secondaryChipsHtml}
          </div>
        </div>
      `;

      // CSS uses this for the hover glow
      card.style.setProperty('--swatch-color', swatch.hex);
      if (animateNextRender) {
        card.style.animationDelay = `${index * 35}ms`;
      }

      card.addEventListener('mouseenter', () => {
        const pinEl = pinsOverlay.children[index];
        if (pinEl) pinEl.classList.add('active-highlight');
      });
      card.addEventListener('mouseleave', () => {
        const pinEl = pinsOverlay.children[index];
        if (pinEl) pinEl.classList.remove('active-highlight');
      });

      if (state.editMode === 'hex') {
        const hexInput = card.querySelector('.swatch-hex-input');
        hexInput.addEventListener('input', (e) => {
          let val = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
          e.target.value = val;
          if (val.length === 3 || val.length === 6) {
            const fullHex = val.length === 3
              ? '#' + val.split('').map(c => c + c).join('')
              : '#' + val;
            updateSwatchColor(index, fullHex);
          }
        });
        hexInput.addEventListener('blur', (e) => {
          let val = e.target.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
          if (val.length === 3) val = val.split('').map(c => c + c).join('');
          else if (val.length !== 6) val = state.swatches[index].hex.replace('#', '');
          e.target.value = val;
          updateSwatchColor(index, `#${val}`);
        });
      } else if (state.editMode === 'rgb') {
        const rgbInputs = card.querySelectorAll('.tri-channel-input');
        const handleRgbChange = () => {
          const r = Math.max(0, Math.min(255, parseInt(rgbInputs[0].value || 0, 10)));
          const g = Math.max(0, Math.min(255, parseInt(rgbInputs[1].value || 0, 10)));
          const b = Math.max(0, Math.min(255, parseInt(rgbInputs[2].value || 0, 10)));
          const newHex = ColorUtils.rgbToHex(r, g, b);
          updateSwatchColor(index, newHex);
        };
        rgbInputs.forEach(inp => inp.addEventListener('input', handleRgbChange));
      } else if (state.editMode === 'hsl') {
        const hslInputs = card.querySelectorAll('.tri-channel-input');
        const handleHslChange = () => {
          const h = Math.max(0, Math.min(360, parseInt(hslInputs[0].value || 0, 10)));
          const s = Math.max(0, Math.min(100, parseInt(hslInputs[1].value || 0, 10)));
          const l = Math.max(0, Math.min(100, parseInt(hslInputs[2].value || 0, 10)));
          const rgbObj = ColorUtils.hslToRgb(h, s, l);
          const newHex = ColorUtils.rgbToHex(rgbObj.r, rgbObj.g, rgbObj.b);
          updateSwatchColor(index, newHex);
        };
        hslInputs.forEach(inp => inp.addEventListener('input', handleHslChange));
      }

      const colorPicker = card.querySelector('.swatch-color-input');
      colorPicker.addEventListener('input', (e) => {
        updateSwatchColor(index, e.target.value.toUpperCase());
      });

      const deleteBtn = card.querySelector('.btn-delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.swatches.length <= 2) {
          showToast('Palette must contain at least 2 colours');
          return;
        }
        state.swatches.splice(index, 1);
        state.palette = state.swatches.map(s => s.hex);
        state.colorCount = state.swatches.length;
        sliderColorCount.value = state.colorCount;
        labelColorCount.textContent = `${state.colorCount} colours`;
        renderSwatches();
        renderColorPins();
      });

      const copyBtn = card.querySelector('.btn-copy-hex');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          copyText(state.swatches[index].hex, `Copied ${state.swatches[index].hex} to clipboard!`);
        });
      }

      card.addEventListener('dragstart', handleDragStart);
      card.addEventListener('dragover', handleDragOver);
      card.addEventListener('drop', handleDrop);
      card.addEventListener('dragend', handleDragEnd);

      swatchesGrid.appendChild(card);
    });

    // clear the flag so edits/dragging don't replay the entrance animation
    animateNextRender = false;
    updateSwatchLayoutAvailability();
  }

  function updateSwatchColor(index, hex) {
    const swatch = state.swatches[index];
    if (!swatch) return;
    swatch.hex = hex;
    swatch.rgb = ColorUtils.hexToRgb(hex);
    state.palette[index] = hex;
    updateCardLive(index);

    const pinEl = pinsOverlay.children[index];
    if (pinEl) pinEl.style.backgroundColor = hex;
  }

  let draggedCardIndex = null;

  function handleDragStart(e) {
    draggedCardIndex = parseInt(this.dataset.index, 10);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(draggedCardIndex));
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e) {
    e.preventDefault();
    if (draggedCardIndex === null) return;
    const targetIndex = parseInt(this.dataset.index, 10);
    if (targetIndex !== draggedCardIndex) {
      const newSwatches = [...state.swatches];
      const movedItem = newSwatches.splice(draggedCardIndex, 1)[0];
      newSwatches.splice(targetIndex, 0, movedItem);
      animateFlipTransition(newSwatches);
    }
    draggedCardIndex = null;
  }

  function handleDragEnd() {
    this.classList.remove('dragging');
    draggedCardIndex = null;
  }

  function openExportModal() {
    if (state.swatches.length === 0) return;
    updateExportSizeLabel();
    updateSwatchLayoutAvailability();
    updateExportCardPreview();
    updateCodeExport();
    exportModal.classList.add('active');
  }

  function updateExportSizeLabel() {
    const dims = Exporter.ASPECT_RATIOS[state.cardAspectRatio] || Exporter.ASPECT_RATIOS['1:1'];
    btnDownloadPng.textContent = `Download High-Res PNG (${dims.width} × ${dims.height})`;
  }

  function updateSwatchLayoutAvailability() {
    const stripsDisabled = state.palette.length > Exporter.MAX_STRIP_COLORS;

    Array.from(selectSwatchLayout.options).forEach(option => {
      if (option.value === 'vertical' || option.value === 'horizontal') {
        option.disabled = stripsDisabled;
      }
    });

    if (stripsDisabled && state.cardSwatchLayout !== 'squares') {
      stripLayoutBeforeFallback = state.cardSwatchLayout;
      state.cardSwatchLayout = 'squares';
      selectSwatchLayout.value = 'squares';
    } else if (!stripsDisabled && stripLayoutBeforeFallback) {
      state.cardSwatchLayout = stripLayoutBeforeFallback;
      selectSwatchLayout.value = stripLayoutBeforeFallback;
      stripLayoutBeforeFallback = null;
    }

    swatchLayoutHint.style.display = stripsDisabled ? 'block' : 'none';
  }

  function openShareModal() {
    if (state.swatches.length === 0) return;
    const url = PaletteShare.getShareUrl(state.palette, 'binary');
    shareLinkInput.value = url;
    shareLengthBadge.textContent = `✓ Length: ${url.length} chars (Zero server network leaks)`;
    shareModal.classList.add('active');
  }

  function scheduleExportCardPreview() {
    const version = ++previewVersion;
    state.cachedCardBlob = null;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => updateExportCardPreview(version), 200);
  }

  async function updateExportCardPreview(version = ++previewVersion) {
    clearTimeout(previewTimer);
    state.cachedCardBlob = null;
    let blob;
    try {
      blob = await Exporter.generatePngCard({
        hexList: state.palette,
        sourceImage: state.sourceImage,
        includeImage: state.includeImageInCard,
        bgMode: state.cardBgMode,
        blurRadius: state.cardBlurRadius,
        includeBranding: state.includeBranding,
        title: state.cardTitle || `Palette: ${state.imageFileName}`,
        aspectRatio: state.cardAspectRatio,
        swatchLayout: state.cardSwatchLayout
      });
    } catch (err) {
      if (version === previewVersion) showToast('Could not generate card preview');
      return;
    }
    if (version !== previewVersion) return;
    if (!blob) {
      showToast('Could not generate card preview');
      return;
    }
    state.cachedCardBlob = blob;
    const oldUrl = previewUrl;
    previewUrl = URL.createObjectURL(blob);
    exportCardImg.src = previewUrl;
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }

  function updateCodeExport() {
    switch (state.currentCodeFormat) {
      case 'css':
        codeOutput.textContent = Exporter.toCssVariables(state.palette);
        break;
      case 'scss':
        codeOutput.textContent = Exporter.toScssVariables(state.palette);
        break;
      case 'tailwind':
        codeOutput.textContent = Exporter.toTailwind(state.palette);
        break;
      case 'json':
        codeOutput.textContent = Exporter.toJson(state.palette);
        break;
      case 'hex':
        codeOutput.textContent = Exporter.toHexList(state.palette);
        break;
      case 'hsl':
        codeOutput.textContent = Exporter.toHslList(state.palette);
        break;
    }
  }

  function handleCodeDownload() {
    const content = codeOutput.textContent;
    let filename = `${state.imageFileName}-palette.txt`;
    let mime = 'text/plain';

    if (state.currentCodeFormat === 'css') {
      filename = `${state.imageFileName}-palette.css`;
      mime = 'text/css';
    } else if (state.currentCodeFormat === 'scss') {
      filename = `${state.imageFileName}-palette.scss`;
      mime = 'text/x-scss';
    } else if (state.currentCodeFormat === 'json') {
      filename = `${state.imageFileName}-palette.json`;
      mime = 'application/json';
    } else if (state.currentCodeFormat === 'tailwind') {
      filename = `tailwind.config.js`;
      mime = 'application/javascript';
    }

    Exporter.downloadText(content, filename, mime);
    showToast(`Downloaded ${filename}!`);
  }

  function loadSampleImage(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');

    if (type === 'sunset') {
      state.imageFileName = 'sunset-landscape';
      state.cardTitle = 'Sunset Landscape';
      const grad = ctx.createLinearGradient(0, 0, 0, 400);
      grad.addColorStop(0, '#FF4B2B');
      grad.addColorStop(0.3, '#FF416C');
      grad.addColorStop(0.6, '#F8A5C2');
      grad.addColorStop(1, '#2B1055');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 600, 400);

      ctx.beginPath();
      ctx.arc(300, 260, 80, 0, Math.PI * 2);
      ctx.fillStyle = '#FFE600';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, 400);
      ctx.lineTo(180, 240);
      ctx.lineTo(320, 360);
      ctx.lineTo(480, 210);
      ctx.lineTo(600, 400);
      ctx.closePath();
      ctx.fillStyle = '#1B003A';
      ctx.fill();
    } else if (type === 'cyberpunk') {
      state.imageFileName = 'cyberpunk-neon';
      state.cardTitle = 'Cyberpunk Neon';
      const grad = ctx.createLinearGradient(0, 0, 600, 400);
      grad.addColorStop(0, '#0F0C29');
      grad.addColorStop(0.5, '#302B63');
      grad.addColorStop(1, '#24243E');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 600, 400);

      ctx.fillStyle = '#00F2FE';
      ctx.fillRect(100, 100, 140, 200);

      ctx.fillStyle = '#FF007F';
      ctx.beginPath();
      ctx.arc(420, 180, 90, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#7928CA';
      ctx.fillRect(260, 220, 200, 120);
    } else {
      state.imageFileName = 'earthy-minimal';
      state.cardTitle = 'Earthy Minimal';
      ctx.fillStyle = '#F5F2EB';
      ctx.fillRect(0, 0, 600, 400);

      ctx.fillStyle = '#8C9A8E';
      ctx.beginPath();
      ctx.arc(220, 200, 110, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#C89666';
      ctx.fillRect(300, 120, 180, 200);

      ctx.fillStyle = '#423B36';
      ctx.beginPath();
      ctx.arc(380, 260, 60, 0, Math.PI * 2);
      ctx.fill();
    }

    inputCardTitle.value = state.cardTitle;

    const img = new Image();
    img.onload = () => {
      state.sourceImage = img;
      state.cachedCardBlob = null;
      previewVersion++;
      clearTimeout(previewTimer);
      showWorkspace();
      displayImageOnCanvas(img);
      recalculatePalette();
    };
    img.onerror = () => showToast('Could not generate that sample image');
    img.src = canvas.toDataURL('image/png');
  }

  function copyText(text, message) {
    const fallback = () => {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0, area.value.length);
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } catch (err) {}
      document.body.removeChild(area);
      showToast(copied ? message : 'Copy failed');
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
      try {
        navigator.clipboard.writeText(text).then(() => showToast(message)).catch(fallback);
      } catch (err) {
        fallback();
      }
    } else {
      fallback();
    }
  }

  let toastTimer = null;
  function showToast(msg) {
    toastMessage.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
