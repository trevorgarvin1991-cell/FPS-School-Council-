(async () => {
  const results = document.getElementById('results');
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  async function test(name, run) {
    const result = document.createElement('li');
    try { await run(); result.className = 'pass'; result.textContent = `PASS: ${name}`; }
    catch (error) { result.className = 'fail'; result.textContent = `FAIL: ${name} — ${error.message}`; }
    results.appendChild(result);
  }
  try {
    const html = await (await fetch('../index.html')).text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const frame = document.getElementById('fixture');
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    frame.srcdoc = `<!doctype html><html><head><base href="${new URL('../', location.href)}">${parsed.querySelector('style').outerHTML}</head><body><button id="floor-plan-tab">Floor plan</button>${parsed.getElementById('floor-plan-panel').outerHTML}<script src="floor-plan.js"></script></body></html>`;
    await loaded;
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const el = (name) => doc.getElementById(`floor-plan-${name}`);
    win.confirm = () => true;
    let session = null;
    let authChange;
    let realtime;
    let failRead = false;
    let failWrite = false;
    let pendingRead = null;
    let mutations = 0;
    let signIns = 0;
    let openedEvents = 0;
    let sequence = 3;
    let published = [];
    const station = (id, label, x, y) => ({ id, event_key: 'test-only', label, details: 'Gym entrance', details_url: '', color: '#d71920', x_percent: x, y_percent: y });
    let data = [station('1', 'BBQ Station', 30, 40), station('2', 'Custom booth', 70, 60)];
    const client = {
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: (callback) => { authChange = callback; }
      },
      channel: () => ({ on(_type, _filter, callback) { realtime = callback; return this; }, subscribe() {} }),
      from(table) {
        assert(table === 'floor_plan_markers', 'Only the floor-plan table may be accessed');
        let operation = 'read';
        let values;
        let id;
        const query = {
          select() { return this; },
          eq(key, value) { if (key === 'id') id = value; return this; },
          order() { return this; },
          insert(value) { operation = 'insert'; values = value; return this; },
          update(value) { operation = 'update'; values = value; return this; },
          delete() { operation = 'delete'; return this; },
          async single() {
            if (!session || failWrite) return { data: null, error: new Error('Write denied') };
            mutations++;
            if (operation === 'insert') { const row = { ...values, id: String(sequence++) }; data.push(row); return { data: { ...row } }; }
            const row = data.find((item) => item.id === id);
            if (!row) return { data: null, error: new Error('Missing row') };
            if (operation === 'update') Object.assign(row, values);
            if (operation === 'delete') data = data.filter((item) => item.id !== id);
            return { data: { ...row } };
          },
          then(resolve, reject) {
            if (pendingRead) {
              const pending = pendingRead;
              pendingRead = null;
              return pending.then(resolve, reject);
            }
            return Promise.resolve(failRead ? { error: new Error('Offline') } : { data: data.map((row) => ({ ...row })) }).then(resolve, reject);
          }
        };
        return query;
      }
    };
    const catalog = [{ key: 'bbq fundraiser', name: 'BBQ fundraiser', group: 'Food' }];
    const controller = win.createFloorPlan({
      client, eventKey: 'test-only', eventCatalog: catalog,
      getMarkerEventKeys: (marker) => marker.label === 'BBQ Station' ? ['bbq fundraiser'] : [marker.label.toLowerCase()],
      showMarkerEvents: () => { openedEvents++; },
      onMarkersChange: (markers) => { published = markers; }, onSignIn: () => { signIns++; }
    });
    const input = (name, value) => { el(name).value = value; el(name).dispatchEvent(new win.Event('input', { bubbles: true })); };
    const change = (name, value) => { el(name).value = value; el(name).dispatchEvent(new win.Event('change', { bubbles: true })); };
    const key = (name, value) => el(name).dispatchEvent(new win.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    const pin = (id) => doc.querySelector(`[data-marker-id="${id}"]`);
    const signIn = () => { session = { user: { id: 'council-test' } }; authChange('SIGNED_IN', session); };
    await tick();
    await test('Public stations load; visitors cannot open the editor', async () => {
      assert(published.length === 2, 'Expected two stations');
      assert(el('add').hidden && !el('sign-in').hidden, 'Visitor access controls');
      el('add').click();
      assert(el('editor').hidden && signIns === 1 && mutations === 0, 'Visitor add must require sign-in');
    });
    await test('Marker selection stays on map; schedule requires explicit action', async () => {
      pin('1').click();
      assert(!el('marker-details-panel').hidden && el('marker-title').textContent === 'BBQ Station', 'Details should open');
      assert(openedEvents === 0, 'Marker must not navigate to schedule');
      el('marker-open-event').click();
      assert(openedEvents === 1, 'Explicit schedule action');
      el('marker-close').click();
    });
    await test('Search matches event aliases and categories include custom stations', async () => {
      input('search', 'fundraiser');
      assert(!pin('1').hidden && pin('2').hidden, 'Alias search');
      el('clear').click();
      change('category', 'Other');
      assert(pin('1').hidden && !pin('2').hidden, 'Custom station filtering');
      input('search', 'missing');
      assert(el('count').textContent.includes('No matching'), 'Empty search message');
      el('clear').click();
    });
    await test('Zoom is bounded, pins stay 44px, and Home fits the map', async () => {
      for (let index = 0; index < 15; index++) el('zoom-in').click();
      assert(el('zoom-value').textContent === '400%', 'Maximum zoom');
      assert(Math.abs(pin('1').getBoundingClientRect().width - 44) < 1, 'Screen-space pin target');
      key('viewport', 'Home');
      assert(el('zoom-value').textContent === '100%', 'Home resets zoom');
      assert(el('zoom-out').disabled, 'Minimum zoom disabled');
    });
    await test('Pointer pan, touch taps, pinch, and cancellation do not write data', async () => {
      const viewport = el('viewport');
      const captured = new Set();
      const native = [viewport.setPointerCapture, viewport.hasPointerCapture, viewport.releasePointerCapture];
      viewport.setPointerCapture = (id) => captured.add(id);
      viewport.hasPointerCapture = (id) => captured.has(id);
      viewport.releasePointerCapture = (id) => captured.delete(id);
      const bounds = viewport.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const pointer = (target, type, id, px, py, pointerType = 'touch') => target.dispatchEvent(new win.PointerEvent(type, {
        bubbles: true, pointerId: id, pointerType, button: 0, clientX: px, clientY: py
      }));
      try {
        pointer(pin('1'), 'pointerdown', 1, x, y);
        pointer(viewport, 'pointerup', 1, x + 2, y);
        assert(!el('marker-details-panel').hidden, 'Touch tap selects pin');
        el('marker-close').click();
        pointer(viewport, 'pointerdown', 1, x - 30, y);
        pointer(viewport, 'pointerdown', 2, x + 30, y);
        pointer(viewport, 'pointermove', 2, x + 90, y);
        assert(el('zoom-value').textContent === '200%', 'Pinch doubles zoom');
        pointer(viewport, 'pointerup', 2, x + 90, y);
        pointer(viewport, 'pointermove', 1, x - 80, y - 50);
        pointer(viewport, 'pointercancel', 1, x - 80, y - 50);
        assert(!viewport.classList.contains('is-panning') && captured.size === 0, 'Cancelled pinch/pan releases capture');
        const transform = new win.DOMMatrix(el('canvas').style.transform);
        assert(transform.e <= 0 && transform.e >= -viewport.clientWidth, 'Horizontal pan stays bounded');
        assert(transform.f <= 0 && transform.f >= -viewport.clientHeight, 'Vertical pan stays bounded');
        pointer(pin('1'), 'pointerdown', 3, x, y);
        pointer(viewport, 'pointermove', 3, x + 30, y);
        pointer(viewport, 'pointerup', 3, x + 30, y);
        assert(el('marker-details-panel').hidden, 'Touch drag pans instead of selecting');
        pin('1').click();
        assert(!el('marker-details-panel').hidden, 'Keyboard/programmatic activation still works after pan');
        el('marker-close').click();
        assert(mutations === 0, 'Navigation never writes markers');
      } finally {
        [viewport.setPointerCapture, viewport.hasPointerCapture, viewport.releasePointerCapture] = native;
        key('viewport', 'Home');
      }
    });
    await test('Signed-in create supports keyboard placement and publishes once', async () => {
      signIn();
      el('add').click();
      input('edit-label', 'Keyboard station');
      input('edit-details', 'East entrance');
      el('place').click();
      key('viewport', 'ArrowRight'); key('viewport', 'ArrowDown'); key('viewport', 'Enter');
      assert(!el('save').disabled, 'Chosen position is saveable');
      el('save').click(); el('save').click();
      await tick();
      const saved = data.find((row) => row.label === 'Keyboard station');
      assert(saved?.x_percent === 51 && saved?.y_percent === 51, 'Keyboard position');
      assert(mutations === 1 && el('editor').hidden, 'Single successful save');
    });
    await test('Failed saves preserve draft fields and position', async () => {
      el('marker-edit').click();
      input('edit-details', 'New details');
      failWrite = true;
      el('save').click(); await tick();
      assert(!el('editor').hidden && el('edit-details').value === 'New details', 'Retain draft');
      assert(el('feedback').textContent.includes('Unable to save'), 'Visible save error');
      failWrite = false;
      el('save').click(); await tick();
      assert(data.find((row) => row.id === '3').details === 'New details', 'Retry saves details');
    });
    await test('Realtime refresh preserves drafts and detects edit conflicts', async () => {
      el('marker-edit').click();
      input('edit-label', 'Unsaved name');
      const currentPin = pin('1');
      await realtime();
      assert(el('edit-label').value === 'Unsaved name' && currentPin === pin('1'), 'Draft and keyed pins preserved');
      data.find((row) => row.id === '3').details = 'Changed remotely';
      await realtime();
      assert(el('save').disabled && el('feedback').textContent.includes('changed elsewhere'), 'Conflict requires reload');
      el('cancel').click();
    });
    await test('Stale fetch cannot replace a newer realtime response', async () => {
      let resolveOld;
      pendingRead = new Promise((resolve) => { resolveOld = resolve; });
      const oldRequest = realtime();
      await tick();
      data.push(station('4', 'Fresh station', 10, 10));
      await realtime();
      resolveOld({ data: [] });
      await oldRequest;
      assert(published.some((marker) => marker.id === '4'), 'Fresh result must win');
    });
    await test('Cancel movement restores stored position and confirms discard', async () => {
      controller.showMarker('1'); await tick();
      el('marker-edit').click();
      el('place').click(); key('viewport', 'ArrowRight'); key('viewport', 'Enter');
      win.confirm = () => false;
      el('cancel').click();
      assert(!el('editor').hidden, 'Dismissed discard keeps editor');
      win.confirm = () => true;
      el('cancel').click();
      assert(pin('1').style.left === '30%' && !pin('draft'), 'Stored position restored');
    });
    await test('Click-to-position uses transformed image coordinates and drag cancellation restores draft', async () => {
      controller.showMarker('1'); await tick(); el('marker-edit').click();
      for (let index = 0; index < 4; index++) el('zoom-in').click();
      el('place').click();
      const viewport = el('viewport');
      const native = [viewport.setPointerCapture, viewport.hasPointerCapture, viewport.releasePointerCapture];
      const captured = new Set();
      viewport.setPointerCapture = (id) => captured.add(id);
      viewport.hasPointerCapture = (id) => captured.has(id);
      viewport.releasePointerCapture = (id) => captured.delete(id);
      const pointer = (target, type, x, y) => target.dispatchEvent(new win.PointerEvent(type, { bubbles: true, pointerId: 10, pointerType: 'mouse', button: 0, clientX: x, clientY: y }));
      try {
        const bounds = el('stage').getBoundingClientRect();
        const x = bounds.left + bounds.width * 0.4;
        const y = bounds.top + bounds.height * 0.5;
        pointer(viewport, 'pointerdown', x, y);
        pointer(viewport, 'pointerup', x, y);
        assert(Math.abs(parseFloat(pin('draft').style.left) - 40) < 0.01, 'Placement accounts for zoom and offset');
        assert(el('position').textContent.includes('50.0% down'), 'Image y coordinate');
        assert(data.find((row) => row.id === '1').x_percent === 30, 'Preview is not a write');
        el('place').click();
        const draftBounds = pin('draft').getBoundingClientRect();
        const dx = draftBounds.left + draftBounds.width / 2;
        const dy = draftBounds.top + draftBounds.height / 2;
        pointer(pin('draft'), 'pointerdown', dx, dy);
        pointer(viewport, 'pointermove', dx + 20, dy + 20);
        pointer(viewport, 'pointercancel', dx + 20, dy + 20);
        assert(Math.abs(parseFloat(pin('draft').style.left) - 40) < 0.01, 'Cancelled move restores previous draft coordinate');
      } finally {
        [viewport.setPointerCapture, viewport.hasPointerCapture, viewport.releasePointerCapture] = native;
        el('cancel').click(); key('viewport', 'Home');
      }
    });
    await test('Removal is confirmed and only affects the selected station', async () => {
      controller.showMarker('4'); await tick(); el('marker-edit').click();
      win.confirm = () => false; el('remove').click(); await tick();
      assert(data.some((row) => row.id === '4'), 'Cancelled removal');
      win.confirm = () => true; el('remove').click(); await tick();
      assert(!data.some((row) => row.id === '4') && data.some((row) => row.id === '1'), 'Targeted delete');
    });
    await test('Remote deletion safely exits editing without recreating a station', async () => {
      controller.showMarker('3'); await tick(); el('marker-edit').click();
      data = data.filter((row) => row.id !== '3'); await realtime();
      assert(el('editor').hidden && el('feedback').textContent.includes('removed by another'), 'Remote delete exits editor');
    });
    await test('Sign-out cancels editing and blocks subsequent mutations', async () => {
      el('add').click(); input('edit-label', 'Discard on logout');
      el('edit-label').focus();
      session = null; authChange('SIGNED_OUT', null);
      const before = mutations;
      el('save').click(); await tick();
      assert(el('editor').hidden && el('add').hidden && mutations === before, 'Logout is read-only');
      assert(doc.activeElement === el('sign-in'), 'Logout restores focus to sign-in');
    });
    await test('Read failures show retry without losing existing stations', async () => {
      failRead = true; await realtime();
      assert(!el('retry').hidden && pin('1'), 'Offline retry and retained pins');
      failRead = false; el('retry').click(); await tick();
      assert(el('retry').hidden && el('count').textContent.includes('2 of 2'), 'Retry restores data');
    });
    await test('Unsafe external links stay hidden; names render as text', async () => {
      data[0].details_url = 'javascript:alert(1)';
      data[0].label = '<img src=x onerror=alert(1)>';
      await realtime(); controller.showMarker('1'); await tick();
      assert(el('marker-link').hidden && !el('marker-title').querySelector('img'), 'No executable marker content');
    });
    window.floorPlanTestFixture = { frame, client, signIn, controller };
    document.title = `${results.querySelectorAll('.fail').length ? 'FAIL' : 'PASS'} — Floor plan regression tests`;
  } catch (error) {
    const result = document.createElement('li');
    result.className = 'fail'; result.textContent = `Fixture error: ${error.stack}`;
    results.appendChild(result);
    document.title = 'FAIL — Floor plan regression tests';
  }
})();