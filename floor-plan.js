(() => {
  'use strict';

  window.createFloorPlan = function createFloorPlan({ client, eventKey, eventCatalog, getMarkerEventKeys, showMarkerEvents, onMarkersChange, onSignIn }) {
    const el = (name) => document.getElementById(`floor-plan-${name}`);
    const viewport = el('viewport');
    const canvas = el('canvas');
    const stage = el('stage');
    const editor = el('editor');
    const search = el('search');
    const category = el('category');
    const pins = new Map();
    const rows = new Map();
    const pointers = new Map();
    const view = { scale: 1, x: 0, y: 0 };
    let markers = [];
    let user = null;
    let selectedId = null;
    let draft = null;
    let placing = false;
    let busy = false;
    let fetchVersion = 0;
    let loaded = false;
    let loadError = false;
    let gesture = null;
    let suppressClick = false;
    let imageReady = false;
    let authVersion = 0;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const feedback = (message) => { el('feedback').textContent = message; };
    const selected = () => markers.find((marker) => marker.id === selectedId);
    const signature = (marker) => JSON.stringify(marker);
    const scrollBehavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';

    function safeUrl(value) {
      try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
      } catch {
        return '';
      }
    }

    function normalizeMarker(marker) {
      return {
        id: marker.id, label: marker.label, details: marker.details || '',
        detailsUrl: marker.details_url || '',
        color: /^#[0-9a-f]{6}$/i.test(marker.color) ? marker.color : '#d71920',
        xPercent: clamp(Number(marker.x_percent) || 0, 0, 100),
        yPercent: clamp(Number(marker.y_percent) || 0, 0, 100)
      };
    }

    function markerEvents(marker) {
      const keys = getMarkerEventKeys(marker);
      return eventCatalog.filter((event) => keys.includes(event.key));
    }

    function matches(marker) {
      const events = markerEvents(marker);
      const text = [marker.label, marker.details, ...events.map((event) => event.name)].join(' ').toLocaleLowerCase();
      const groupMatches = !category.value || (category.value === 'Other' ? !events.length : events.some((event) => event.group === category.value));
      return groupMatches && text.includes(search.value.trim().toLocaleLowerCase());
    }

    function renderView() {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) return;
      view.x = clamp(view.x, width * (1 - view.scale), 0);
      view.y = clamp(view.y, height * (1 - view.scale), 0);
      canvas.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
      canvas.style.setProperty('--pin-scale', String(1 / view.scale));
      el('zoom-value').textContent = `${Math.round(view.scale * 100)}%`;
      el('zoom-out').disabled = view.scale <= 1;
      el('zoom-in').disabled = view.scale >= 4;
    }

    function zoom(scale, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
      const next = clamp(scale, 1, 4);
      const ratio = next / view.scale;
      view.x = x - (x - view.x) * ratio;
      view.y = y - (y - view.y) * ratio;
      view.scale = next;
      renderView();
    }

    function fit() {
      Object.assign(view, { scale: 1, x: 0, y: 0 });
      renderView();
    }

    function centerMarker(marker) {
      view.x = viewport.clientWidth / 2 - viewport.clientWidth * view.scale * marker.xPercent / 100;
      view.y = viewport.clientHeight / 2 - viewport.clientHeight * view.scale * marker.yPercent / 100;
      renderView();
    }

    function pointOnImage(clientX, clientY) {
      if (!imageReady) return null;
      const bounds = stage.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      const xPercent = (clientX - bounds.left) / bounds.width * 100;
      const yPercent = (clientY - bounds.top) / bounds.height * 100;
      if (xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) return null;
      return { xPercent, yPercent };
    }

    function setPlacing(value) {
      placing = value;
      viewport.classList.toggle('is-placing', value);
      el('place').setAttribute('aria-pressed', String(value));
      el('place').textContent = value ? 'Accept position' : (draft?.position ? 'Move marker' : 'Place on map');
    }

    function updatePosition() {
      el('position').textContent = draft?.position
        ? `Position: ${draft.position.xPercent.toFixed(1)}% across, ${draft.position.yPercent.toFixed(1)}% down`
        : 'Choose a position on the map before saving.';
      el('save').disabled = busy || !draft?.position || placing || !!draft?.conflict;
    }

    function renderAccess() {
      el('add').hidden = !user;
      el('add').disabled = busy;
      el('sign-in').hidden = !!user;
      el('marker-edit').hidden = !user;
      el('editor-fields').disabled = busy;
      el('editor').setAttribute('aria-busy', String(busy));
      search.disabled = !!draft;
      category.disabled = !!draft;
      el('clear').disabled = !!draft;
      el('palette').querySelectorAll('button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.color === el('edit-color').value));
      });
      updatePosition();
    }

    function renderDetails() {
      const marker = selected();
      el('list-panel').hidden = !!marker || !!draft;
      el('marker-details-panel').hidden = !marker || !!draft;
      editor.hidden = !draft;
      if (marker && !draft) {
        el('marker-title').textContent = marker.label;
        const eventLocation = markerEvents(marker).map((event) => event.location).filter(Boolean).join(' ');
        el('marker-description').textContent = marker.details || eventLocation || 'No location notes have been added yet.';
        const url = safeUrl(marker.detailsUrl);
        el('marker-link').hidden = !url;
        el('marker-link').removeAttribute('href');
        if (url) el('marker-link').href = url;
        el('marker-open-event').hidden = !markerEvents(marker).length;
      }
      renderAccess();
    }

    function makePin(id) {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'floor-plan-marker';
      pin.dataset.markerId = id;
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        if ((suppressClick && event.detail !== 0) || draft || busy) return;
        selectMarker(id, false);
      });
      stage.appendChild(pin);
      pins.set(id, pin);
      return pin;
    }

    function renderMarkers() {
      const visible = markers.filter(matches);
      const currentIds = new Set(markers.map((marker) => marker.id));
      for (const [id, pin] of pins) {
        if (!currentIds.has(id) && id !== 'draft') { pin.remove(); pins.delete(id); }
      }
      for (const [id, row] of rows) {
        if (!currentIds.has(id)) { row.remove(); rows.delete(id); }
      }
      markers.forEach((marker, index) => {
        const pin = pins.get(marker.id) || makePin(marker.id);
        const isVisible = visible.includes(marker);
        pin.hidden = !isVisible || draft?.id === marker.id;
        pin.style.left = `${marker.xPercent}%`;
        pin.style.top = `${marker.yPercent}%`;
        pin.style.setProperty('--marker-color', marker.color);
        pin.textContent = String(index + 1);
        pin.title = marker.label;
        pin.setAttribute('aria-label', `${index + 1}. ${marker.label}. Show station details`);
        pin.setAttribute('aria-pressed', String(selectedId === marker.id));
        pin.classList.toggle('is-selected', selectedId === marker.id);
        let row = rows.get(marker.id);
        if (!row) {
          row = document.createElement('button');
          row.type = 'button';
          row.className = 'floor-plan-legend-item';
          const swatch = document.createElement('span');
          swatch.className = 'floor-plan-legend-swatch';
          swatch.setAttribute('aria-hidden', 'true');
          row.append(swatch, document.createElement('span'));
          row.addEventListener('click', () => selectMarker(marker.id, true));
          el('legend').appendChild(row);
          rows.set(marker.id, row);
        }
        row.hidden = !isVisible;
        row.style.setProperty('--marker-color', marker.color);
        row.lastChild.textContent = `${index + 1}. ${marker.label}`;
        row.setAttribute('aria-pressed', String(selectedId === marker.id));
      });
      const preview = pins.get('draft');
      if (draft?.position) {
        const pin = preview || makePin('draft');
        pin.hidden = false;
        pin.classList.add('is-draft');
        pin.textContent = '+';
        pin.style.left = `${draft.position.xPercent}%`;
        pin.style.top = `${draft.position.yPercent}%`;
        pin.style.setProperty('--marker-color', el('edit-color').value);
        pin.setAttribute('aria-label', 'Unsaved marker position. Use Move marker to reposition.');
      } else if (preview) {
        preview.remove();
        pins.delete('draft');
      }
      el('count').textContent = !loaded && !loadError ? 'Loading stations…'
        : loadError ? 'Station list unavailable. Retry loading.'
        : !markers.length ? 'No stations added yet.'
        : !visible.length ? 'No matching stations. Try another search or clear filters.'
        : `${visible.length} of ${markers.length} stations`;
      renderDetails();
    }

    function abandonDraft() {
      if (busy) return false;
      if (draft && !window.confirm('Discard these unsaved station changes?')) return false;
      draft = null;
      setPlacing(false);
      return true;
    }

    function selectMarker(id, center) {
      if (!abandonDraft()) return;
      selectedId = id;
      renderMarkers();
      const marker = selected();
      if (center && marker) centerMarker(marker);
      el('marker-close').focus({ preventScroll: true });
      if (matchMedia('(max-width: 900px)').matches) {
        el('marker-details-panel').scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
      }
    }

    function beginEditor(marker = null) {
      if (!user) { onSignIn(); return; }
      if (!abandonDraft()) return;
      selectedId = marker?.id || null;
      draft = {
        id: marker?.id || null, base: marker ? signature(marker) : null, conflict: false,
        position: marker ? { xPercent: marker.xPercent, yPercent: marker.yPercent } : null
      };
      el('edit-label').value = marker?.label || '';
      el('edit-details').value = marker?.details || '';
      el('edit-url').value = marker?.detailsUrl || '';
      el('edit-color').value = marker?.color || '#d71920';
      el('edit-url').setCustomValidity('');
      el('edit-label').setCustomValidity('');
      el('editor-title').textContent = marker ? 'Edit station' : 'Add a station';
      el('remove').hidden = !marker;
      el('cancel').textContent = 'Cancel';
      setPlacing(false);
      renderMarkers();
      feedback(marker ? 'Edit details or choose Move marker. Changes are saved only when you select Save.' : 'Add station details, choose a position, then save.');
      el('edit-label').focus();
    }

    function cancelEditor(force = false) {
      if (!force && !abandonDraft()) return;
      draft = null;
      setPlacing(false);
      renderMarkers();
      feedback('Unsaved changes discarded.');
      (selected() ? el('marker-edit') : user ? el('add') : el('sign-in')).focus({ preventScroll: true });
    }

    function togglePlacement() {
      if (!draft || busy || !user || draft.conflict) return;
      if (!imageReady) { feedback('The floor-plan image is not available. Reload the page to try again.'); return; }
      if (placing) {
        setPlacing(false);
        updatePosition();
        el('save').focus();
        feedback('Position chosen. Save to publish this station.');
        return;
      }
      if (!draft.position) draft.position = { xPercent: 50, yPercent: 50 };
      setPlacing(true);
      centerMarker(draft.position);
      renderMarkers();
      viewport.focus({ preventScroll: true });
      feedback('Click the map or drag the + pin to choose a position. Arrow keys move it; Enter accepts. Escape cancels.');
    }

    function applyAuth(nextUser) {
      const changed = user?.id !== nextUser?.id;
      const restoreFocus = changed && draft && (editor.contains(document.activeElement) || document.activeElement === viewport);
      user = nextUser;
      if (changed && draft) {
        draft = null;
        setPlacing(false);
        feedback('Account changed. Unsaved floor-plan changes were discarded.');
      }
      renderMarkers();
      if (restoreFocus) (user ? el('add') : el('sign-in')).focus({ preventScroll: true });
    }

    async function verifyEditor() {
      const version = ++authVersion;
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (version === authVersion) applyAuth(data.session?.user || null);
        if (!user) { onSignIn(); return false; }
        return true;
      } catch {
        feedback('Unable to verify sign-in. Please try again.');
        return false;
      }
    }

    async function synchronizeFloorPlanMarkers() {
      const version = ++fetchVersion;
      try {
        const { data, error } = await client.from('floor_plan_markers').select('*').eq('event_key', eventKey).order('created_at');
        if (version !== fetchVersion) return;
        if (error) throw error;
        const recovered = loadError;
        markers = data.map(normalizeMarker);
        loaded = true;
        loadError = false;
        el('retry').hidden = true;
        if (recovered) feedback('Stations are up to date.');
        if (draft?.id && !busy) {
          const current = markers.find((marker) => marker.id === draft.id);
          if (!current) {
            const restoreFocus = editor.contains(document.activeElement) || document.activeElement === viewport;
            draft = null;
            selectedId = null;
            setPlacing(false);
            feedback('This station was removed by another editor. Your changes were not saved.');
            if (restoreFocus) {
              renderAccess();
              search.focus({ preventScroll: true });
            }
          } else if (signature(current) !== draft.base) {
            draft.conflict = true;
            setPlacing(false);
            el('cancel').textContent = 'Discard & reload';
            feedback('This station changed elsewhere. Your draft is preserved; discard and reopen it to use the latest version.');
          }
        }
        if (selectedId && !selected()) {
          const restoreFocus = el('marker-details-panel').contains(document.activeElement);
          selectedId = null;
          if (restoreFocus) search.focus({ preventScroll: true });
        }
        renderMarkers();
        onMarkersChange(markers);
      } catch {
        if (version !== fetchVersion) return;
        loadError = true;
        el('retry').hidden = false;
        feedback('Unable to load the latest stations. Check your connection and retry.');
        renderMarkers();
      }
    }

    async function persist(remove = false) {
      if (busy || !draft) return;
      if (!remove && (placing || !draft.position || draft.conflict)) {
        feedback(draft.conflict ? 'Reload this station before saving.' : 'Choose and accept a map position before saving.');
        return;
      }
      if (!remove) {
        el('edit-label').setCustomValidity(el('edit-label').value.trim() ? '' : 'Enter a station name.');
        const url = el('edit-url').value.trim();
        el('edit-url').setCustomValidity(!url || safeUrl(url) ? '' : 'Use a full https:// or http:// link.');
        if (!editor.reportValidity()) return;
      }
      if (remove && (!draft.id || !window.confirm(`Remove “${selected()?.label || 'this station'}” from the floor plan?`))) return;
      const savingDraft = draft;
      const actorId = user?.id;
      busy = true;
      renderAccess();
      feedback(remove ? 'Removing station…' : 'Saving station…');
      try {
        if (!await verifyEditor() || draft !== savingDraft || user?.id !== actorId) return;
        const values = {
          label: el('edit-label').value.trim(), details: el('edit-details').value.trim(),
          details_url: el('edit-url').value.trim(), color: el('edit-color').value,
          x_percent: savingDraft.position?.xPercent, y_percent: savingDraft.position?.yPercent
        };
        let query = client.from('floor_plan_markers');
        if (remove) query = query.delete().eq('id', savingDraft.id).eq('event_key', eventKey);
        else if (savingDraft.id) query = query.update(values).eq('id', savingDraft.id).eq('event_key', eventKey);
        else query = query.insert({ ...values, event_key: eventKey });
        const { data, error } = await query.select('*').single();
        if (error || !data) throw error || new Error('No station changed');
        ++fetchVersion;
        if (remove) markers = markers.filter((marker) => marker.id !== savingDraft.id);
        else {
          const saved = normalizeMarker(data);
          const index = markers.findIndex((marker) => marker.id === saved.id);
          if (index < 0) markers.push(saved);
          else markers[index] = saved;
        }
        onMarkersChange(markers);
        if (draft === savingDraft) {
          draft = null;
          setPlacing(false);
          selectedId = remove ? null : data.id;
          search.value = '';
          category.value = '';
        }
        feedback(remove ? 'Station removed.' : 'Station saved.');
      } catch {
        feedback(remove ? 'Unable to remove this station. It may have changed or your access expired. Retry after reloading stations.' : 'Unable to save. Your draft is retained. Check your connection and sign-in, then try again.');
      } finally {
        busy = false;
        await synchronizeFloorPlanMarkers();
        renderMarkers();
        if (!draft) (selected() ? el('marker-close') : user ? el('add') : el('sign-in')).focus({ preventScroll: true });
      }
    }

    function resetGesture() {
      for (const id of pointers.keys()) {
        if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
      }
      pointers.clear();
      gesture = null;
      viewport.classList.remove('is-panning');
    }

    function startGesture() {
      const points = [...pointers.values()];
      if (points.length >= 2) {
        const [a, b] = points;
        const bounds = viewport.getBoundingClientRect();
        const x = (a.x + b.x) / 2 - bounds.left;
        const y = (a.y + b.y) / 2 - bounds.top;
        gesture = { type: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: view.scale, imageX: (x - view.x) / view.scale, imageY: (y - view.y) / view.scale, moved: true };
        suppressClick = true;
      }
    }

    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || busy) return;
      const pin = event.target.closest('.floor-plan-marker');
      if (pin && !placing && event.pointerType !== 'touch') {
        suppressClick = false;
        return;
      }
      viewport.focus({ preventScroll: true });
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        suppressClick = false;
        gesture = { type: placing && pin?.dataset.markerId === 'draft' ? 'move' : 'pan', startX: event.clientX, startY: event.clientY, x: view.x, y: view.y, moved: false, pinId: pin?.dataset.markerId, position: draft?.position ? { ...draft.position } : null };
      } else startGesture();
      viewport.setPointerCapture(event.pointerId);
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture.type === 'pinch') {
        const [a, b] = [...pointers.values()];
        if (!b) return;
        const bounds = viewport.getBoundingClientRect();
        view.scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, 1, 4);
        view.x = (a.x + b.x) / 2 - bounds.left - gesture.imageX * view.scale;
        view.y = (a.y + b.y) / 2 - bounds.top - gesture.imageY * view.scale;
        renderView();
        return;
      }
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
      gesture.moved = true;
      suppressClick = true;
      if (gesture.type === 'move' && draft && placing) {
        const point = pointOnImage(event.clientX, event.clientY);
        if (point) { draft.position = point; renderMarkers(); }
      } else {
        viewport.classList.add('is-panning');
        view.x = gesture.x + dx;
        view.y = gesture.y + dy;
        renderView();
      }
    });

    function endPointer(event, cancelled = false) {
      if (!pointers.has(event.pointerId)) return;
      const finished = gesture;
      pointers.delete(event.pointerId);
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      if (cancelled && finished?.type === 'move' && draft) {
        draft.position = finished.position;
        renderMarkers();
      }
      if (pointers.size) {
        const point = [...pointers.values()][0];
        gesture = { type: 'pan', startX: point.x, startY: point.y, x: view.x, y: view.y, moved: true };
        return;
      }
      gesture = null;
      viewport.classList.remove('is-panning');
      if (cancelled || !finished) return;
      if (placing && draft && (finished.type === 'move' || !finished.moved)) {
        const point = pointOnImage(event.clientX, event.clientY);
        if (point) {
          draft.position = point;
          setPlacing(false);
          renderMarkers();
          feedback('Position chosen. Save to publish, or Move marker to adjust.');
          el('save').focus({ preventScroll: true });
        }
      } else if (finished.pinId && !finished.moved && !draft) {
        suppressClick = true;
        selectMarker(finished.pinId, false);
      }
    }

    viewport.addEventListener('pointerup', (event) => endPointer(event));
    viewport.addEventListener('pointercancel', (event) => endPointer(event, true));
    viewport.addEventListener('lostpointercapture', (event) => endPointer(event, true));
    window.addEventListener('blur', resetGesture);
    viewport.addEventListener('wheel', (event) => {
      if (document.activeElement !== viewport || event.ctrlKey || event.metaKey || pointers.size) return;
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      zoom(view.scale + (event.deltaY < 0 ? 0.25 : -0.25), event.clientX - bounds.left, event.clientY - bounds.top);
    }, { passive: false });
    viewport.addEventListener('keydown', (event) => {
      if (event.target !== viewport || event.ctrlKey || event.metaKey || event.altKey || busy) return;
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[event.key]) {
        event.preventDefault();
        const [x, y] = arrows[event.key];
        if (placing && draft?.position) {
          const step = event.shiftKey ? 5 : 1;
          draft.position.xPercent = clamp(draft.position.xPercent + x * step, 0, 100);
          draft.position.yPercent = clamp(draft.position.yPercent + y * step, 0, 100);
          renderMarkers();
        } else {
          view.x -= x * 40;
          view.y -= y * 40;
          renderView();
        }
      } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(view.scale + 0.25); }
      else if (event.key === '-') { event.preventDefault(); zoom(view.scale - 0.25); }
      else if (event.key === '0' || event.key === 'Home') { event.preventDefault(); fit(); }
      else if (event.key === 'Enter' && placing) { event.preventDefault(); togglePlacement(); }
    });
    el('panel').addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || busy) return;
      event.preventDefault();
      resetGesture();
      if (draft) cancelEditor();
      else closeDetails();
    });

    function closeDetails() {
      const previous = selectedId;
      selectedId = null;
      renderMarkers();
      (rows.get(previous) || search).focus({ preventScroll: true });
    }

    function filterMarkers() {
      if (selected() && !matches(selected())) selectedId = null;
      renderMarkers();
    }
    search.addEventListener('input', filterMarkers);
    category.addEventListener('change', filterMarkers);
    el('clear').addEventListener('click', () => { search.value = ''; category.value = ''; filterMarkers(); search.focus(); });
    el('zoom-in').addEventListener('click', () => zoom(view.scale + 0.25));
    el('zoom-out').addEventListener('click', () => zoom(view.scale - 0.25));
    el('reset').addEventListener('click', fit);
    el('add').addEventListener('click', () => beginEditor());
    el('sign-in').addEventListener('click', onSignIn);
    el('marker-edit').addEventListener('click', () => { if (selected()) beginEditor(selected()); });
    el('marker-close').addEventListener('click', closeDetails);
    el('marker-open-event').addEventListener('click', () => { if (selected()) showMarkerEvents(selected()); });
    el('place').addEventListener('click', togglePlacement);
    el('cancel').addEventListener('click', () => cancelEditor());
    el('remove').addEventListener('click', () => { void persist(true); });
    el('retry').addEventListener('click', () => { void synchronizeFloorPlanMarkers(); });
    editor.addEventListener('submit', (event) => { event.preventDefault(); void persist(); });
    el('edit-color').addEventListener('input', renderMarkers);
    el('edit-label').addEventListener('input', () => el('edit-label').setCustomValidity(''));
    el('edit-url').addEventListener('input', () => el('edit-url').setCustomValidity(''));
    [['Red', '#d71920'], ['Blue', '#1674a5'], ['Green', '#218545'], ['Purple', '#883eac']].forEach(([name, color]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.color = color;
      button.style.setProperty('--marker-color', color);
      button.setAttribute('aria-label', `${name} pin`);
      button.title = name;
      button.addEventListener('click', () => { el('edit-color').value = color; renderMarkers(); });
      el('palette').appendChild(button);
    });
    const image = stage.querySelector('img');
    function imageLoaded() {
      imageReady = image.naturalWidth > 0;
      if (imageReady) viewport.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
      renderView();
    }
    image.addEventListener('load', imageLoaded);
    image.addEventListener('error', () => { imageReady = false; feedback('The floor-plan image could not load. Station details are still available. Reload the page to retry.'); });
    if (image.complete) imageLoaded();
    new ResizeObserver(renderView).observe(viewport);
    client.auth.onAuthStateChange((_event, session) => {
      ++authVersion;
      applyAuth(session?.user || null);
    });
    const initialAuthVersion = authVersion;
    client.auth.getSession().then(({ data }) => {
      if (initialAuthVersion === authVersion) applyAuth(data.session?.user || null);
    }).catch(() => feedback('Sign-in status unavailable. Viewing remains available.'));
    renderMarkers();
    renderView();
    void synchronizeFloorPlanMarkers();
    client.channel(`floor-plan-${eventKey}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'floor_plan_markers', filter: `event_key=eq.${eventKey}`
    }, synchronizeFloorPlanMarkers).subscribe();

    return {
      showMarker(id) {
        if (!abandonDraft()) return;
        search.value = '';
        category.value = '';
        document.getElementById('floor-plan-tab').click();
        selectedId = id;
        renderMarkers();
        requestAnimationFrame(() => {
          if (!selected()) return;
          centerMarker(selected());
          viewport.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
          pins.get(id)?.focus({ preventScroll: true });
        });
      }
    };
  };
})();