(() => {
    const ARTICLE_KEYWORD_FAMILIES = [
        { keywords: ['CUELLOS', 'CUELLO'], label: 'Cuello' },
        { keywords: ['PUÑOS', 'PUÑO'], label: 'Puño' },
        { keywords: ['PRETINAS', 'PRETINA'], label: 'Pretina' }
    ];
    const RELATED_PARTIDA_RANGE = 10;

    const state = {
        records: [],
        filteredRecords: [],
        currentQuery: '',
        selectedIds: new Set(),
        toastTimer: null,
        syncing: false
    };

    function getElements() {
        return {
            form: document.getElementById('secado-mobile-search-form'),
            searchInput: document.getElementById('secado-mobile-search'),
            scanButton: document.getElementById('secado-mobile-scan-button'),
            syncStatus: document.getElementById('secado-mobile-sync-status'),
            resultSummary: document.getElementById('secado-mobile-result-summary'),
            resultList: document.getElementById('secado-mobile-results'),
            selectAllBtn: document.getElementById('secado-mobile-select-all'),
            formCard: document.getElementById('secado-mobile-form-card'),
            selectionSummary: document.getElementById('secado-mobile-selection-summary'),
            turnoInput: document.getElementById('secado-mobile-turno'),
            operarioInput: document.getElementById('secado-mobile-operario'),
            inicioBtn: document.getElementById('secado-mobile-inicio'),
            finBtn: document.getElementById('secado-mobile-fin'),
            toast: document.getElementById('secado-mobile-toast')
        };
    }

    function calculateTurno() {
        const hours = new Date().getHours();
        return (hours >= 7 && hours < 19) ? '1T' : '2T';
    }

    function hasOpenPass(record) {
        return Boolean(record.secado_inicio) && !record.secado_fin;
    }

    function detectKeywordFamily(articulo) {
        const upper = String(articulo || '').toUpperCase();
        for (const family of ARTICLE_KEYWORD_FAMILIES) {
            for (const kw of family.keywords) {
                if (upper.includes(kw)) return family;
            }
        }
        return null;
    }

    function getStatusInfo(record) {
        if (hasOpenPass(record)) {
            return { label: 'En proceso', pillClass: 'status-in-progress', cardClass: 'record-card-in-progress' };
        }
        if (record.secado_inicio && record.secado_fin) {
            return { label: 'Terminado', pillClass: 'status-registered', cardClass: '' };
        }
        return { label: 'Pendiente', pillClass: 'status-pending', cardClass: '' };
    }

    function buildPassesHtml(record) {
        if (!record.secado_inicio) return '';

        const turno = TintoreriaUtils.escapeHtml(record.secado_turno || '');
        const operario = TintoreriaUtils.escapeHtml(record.secado_operario || '');
        const inicio = TintoreriaUtils.escapeHtml(record.secado_inicio || '');
        const fin = record.secado_fin ? TintoreriaUtils.escapeHtml(record.secado_fin) : '';
        const isOpen = !fin;

        const metaParts = [turno, operario].filter(Boolean).join(' · ');
        const timeLabel = fin
            ? `${inicio} → ${fin}`
            : `${inicio} → en curso...`;

        return `
            <div class="record-passes">
                <div class="pass-line${isOpen ? ' pass-line-open' : ''}">
                    <strong>Secado${metaParts ? ` — <span class="pass-meta">${metaParts}</span>` : ''}</strong>
                    <span class="pass-time${isOpen ? ' pass-time-open' : ''}">${timeLabel}</span>
                </div>
            </div>
        `;
    }

    function formatRecordTitle(record) {
        return `${record.cliente || 'Sin cliente'} - ${TintoreriaUtils.formatOpPartida(record.op_tela, record.partida)}`;
    }

    function findRecordById(recordId) {
        return state.records.find((r) => String(r.id_registro || '') === String(recordId || '')) || null;
    }

    function setSyncStatus(message, isError = false) {
        const { syncStatus } = getElements();
        if (!syncStatus) return;
        syncStatus.textContent = message;
        syncStatus.style.color = isError ? 'var(--danger-text)' : 'var(--muted)';
    }

    function showToast(message) {
        const { toast } = getElements();
        if (!toast) return;
        toast.textContent = message;
        toast.classList.remove('hidden');
        if (state.toastTimer) clearTimeout(state.toastTimer);
        state.toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 3200);
    }

    function setRecords(records) {
        state.records = TintoreriaUtils.sortRecords(
            (records || []).map((r) => TintoreriaUtils.defaultRecord(r))
        );
    }

    function filterByExactOpPartida(query) {
        const normalizedQuery = TintoreriaUtils.normalizeOpPartidaSearchValue(query);
        if (!normalizedQuery) return [];

        const exactMatches = state.records.filter((r) => {
            const opPartida = TintoreriaUtils.formatOpPartida(r.op_tela, r.partida);
            return TintoreriaUtils.normalizeOpPartidaSearchValue(opPartida) === normalizedQuery;
        });

        if (!exactMatches.length) return [];

        let matchedFamily = null;
        for (const r of exactMatches) {
            matchedFamily = detectKeywordFamily(r.articulo);
            if (matchedFamily) break;
        }

        if (!matchedFamily) return exactMatches;

        const anchor = exactMatches[0];
        const anchorOpTela = String(anchor.op_tela || '').trim();
        const anchorPartida = parseInt(String(anchor.partida || '').trim(), 10);
        if (!Number.isFinite(anchorPartida)) return exactMatches;

        const exactIds = new Set(exactMatches.map((r) => String(r.id_registro || '')));
        const familyLabel = matchedFamily.label;
        const anchorColor = String(anchor.color || '').trim().toUpperCase();

        const related = state.records
            .filter((r) => {
                if (String(r.op_tela || '').trim() !== anchorOpTela) return false;
                if (exactIds.has(String(r.id_registro || ''))) return false;
                const rFamily = detectKeywordFamily(r.articulo);
                if (!rFamily || rFamily.label !== familyLabel) return false;
                if (String(r.color || '').trim().toUpperCase() !== anchorColor) return false;
                const rPartida = parseInt(String(r.partida || '').trim(), 10);
                if (!Number.isFinite(rPartida)) return false;
                return Math.abs(rPartida - anchorPartida) <= RELATED_PARTIDA_RANGE;
            })
            .map((r) => ({ ...r, _isRelated: true, _groupKeyword: familyLabel }));

        related.sort((a, b) => {
            const aPartida = parseInt(String(a.partida || '').trim(), 10);
            const bPartida = parseInt(String(b.partida || '').trim(), 10);
            return Math.abs(aPartida - anchorPartida) - Math.abs(bPartida - anchorPartida);
        });

        return [...exactMatches, ...related];
    }

    function getSelectableVisibleIds() {
        return state.filteredRecords
            .map((r) => String(r.id_registro || ''))
            .filter(Boolean);
    }

    function pruneSelection() {
        const validIds = new Set(getSelectableVisibleIds());
        const next = new Set();
        state.selectedIds.forEach((id) => { if (validIds.has(id)) next.add(id); });
        state.selectedIds = next;
    }

    function renderResults() {
        const els = getElements();
        if (!els.resultList || !els.resultSummary || !els.formCard || !els.selectAllBtn) return;

        const query = state.currentQuery.trim();

        if (!query) {
            state.filteredRecords = [];
            state.selectedIds.clear();
            els.resultSummary.textContent = 'Ingresa una OP-PTDA para comenzar.';
            els.resultList.innerHTML = '<div class="empty-state">Ingresa una OP-PTDA para ver coincidencias exactas.</div>';
            els.formCard.classList.add('hidden');
            els.selectAllBtn.classList.add('hidden');
            return;
        }

        state.filteredRecords = filterByExactOpPartida(query);
        pruneSelection();

        if (!state.filteredRecords.length) {
            // Puede ser un registro recien agregado al Sheet: re-sincroniza sin recargar la pagina.
            requestAutoRefresh();
            els.resultSummary.textContent = 'No se encontraron filas para esa OP-PTDA.';
            els.resultList.innerHTML = '<div class="empty-state">No se encontraron coincidencias exactas para la OP-PTDA ingresada.</div>';
            els.formCard.classList.add('hidden');
            els.selectAllBtn.classList.add('hidden');
            return;
        }

        const selectableIds = getSelectableVisibleIds();
        const selectedCount = selectableIds.filter((id) => state.selectedIds.has(id)).length;

        const relatedCount = state.filteredRecords.filter((r) => r._isRelated).length;
        const groupKeyword = relatedCount > 0 ? ((state.filteredRecords.find((r) => r._isRelated) || {})._groupKeyword || '') : '';
        els.resultSummary.textContent = relatedCount > 0
            ? `${state.filteredRecords.length - relatedCount} exacta + ${relatedCount} agrupada(s) — ${groupKeyword}`
            : '';
        els.selectAllBtn.classList.toggle('hidden', selectableIds.length === 0);
        els.selectAllBtn.textContent =
            selectableIds.length > 0 && selectedCount === selectableIds.length
                ? 'Limpiar seleccion'
                : 'Seleccionar todo';

        els.resultList.innerHTML = state.filteredRecords.map((record) => {
            const recordId = String(record.id_registro || '');
            const checked = state.selectedIds.has(recordId) ? 'checked' : '';
            const status = getStatusInfo(record);
            const selectedClass = checked ? ' record-card-selected' : '';
            const color = TintoreriaUtils.escapeHtml(TintoreriaUtils.formatColorLabel(record.color || 'Sin color'));
            const article = TintoreriaUtils.escapeHtml(record.articulo || 'Sin articulo');
            const ruta = TintoreriaUtils.escapeHtml(record.ruta || '—');
            const passesHtml = buildPassesHtml(record);

            const selectRow = `<div class="select-row"><label class="checkbox-label"><input type="checkbox" class="secado-mobile-checkbox" data-record-id="${TintoreriaUtils.escapeHtml(recordId)}" ${checked}>Seleccionar</label></div>`;
            const relatedBanner = record._isRelated
                ? `<div class="related-group-banner"><span class="related-group-tag">Agrupado · ${TintoreriaUtils.escapeHtml(record._groupKeyword || '')}</span></div>`
                : '';

            return `
                <article
                    class="record-card record-card-selectable${status.cardClass ? ` ${status.cardClass}` : ''}${selectedClass}"
                    data-record-id="${TintoreriaUtils.escapeHtml(recordId)}"
                >
                    ${relatedBanner}
                    <div class="record-head">
                        <div class="record-title">${TintoreriaUtils.escapeHtml(formatRecordTitle(record))}</div>
                        <span class="status-pill ${status.pillClass}">${TintoreriaUtils.escapeHtml(status.label)}</span>
                    </div>
                    <div class="record-detail-line"><strong>${color}</strong> <span>${article}</span></div>
                    <div class="record-meta">
                        <div class="meta-line"><strong>Kg(crudo):</strong> ${TintoreriaUtils.escapeHtml(record.peso_kg_crudo || '0')} <span class="meta-separator">|</span> <strong>#rollos/cntd:</strong> ${TintoreriaUtils.escapeHtml(record.cantidad_crudo || '0')}</div>
                        <div class="meta-line"><strong>Ruta:</strong> ${ruta}</div>
                    </div>
                    ${passesHtml}
                    ${selectRow}
                </article>
            `;
        }).join('');

        if (els.selectionSummary) els.selectionSummary.textContent = '';
        els.formCard.classList.toggle('hidden', selectedCount === 0);
        populateForm();
        updateActionButtons();
    }

    function clearFormFields() {
        const els = getElements();
        if (els.operarioInput) els.operarioInput.value = '';
    }

    // Devuelve el valor si todos los registros coinciden; '' si difieren o no hay ninguno.
    function commonValue(records, fieldName) {
        const values = records.map((r) => String(r[fieldName] || ''));
        const unique = Array.from(new Set(values));
        return unique.length === 1 ? unique[0] : '';
    }

    function populateForm() {
        const els = getElements();
        const openRecords = Array.from(state.selectedIds)
            .map((id) => findRecordById(id))
            .filter((r) => r && hasOpenPass(r));

        // Pre-cargamos con el valor común de los registros con proceso abierto.
        // Si son varios y comparten Operario/Turno (mismo dato), se muestra; si difieren, queda vacío.
        if (openRecords.length > 0) {
            if (els.operarioInput) els.operarioInput.value = commonValue(openRecords, 'secado_operario');
            if (els.turnoInput) els.turnoInput.value = commonValue(openRecords, 'secado_turno') || calculateTurno();
            return;
        }

        clearFormFields();
        if (els.turnoInput) els.turnoInput.value = calculateTurno();
    }

    function updateActionButtons() {
        const els = getElements();
        const selectedRecords = Array.from(state.selectedIds)
            .map((id) => findRecordById(id))
            .filter(Boolean);
        const anyOpen = selectedRecords.some((r) => hasOpenPass(r));
        const anyNotOpen = selectedRecords.some((r) => !hasOpenPass(r));

        if (els.inicioBtn) {
            const blockInicio = selectedRecords.length > 0 && !anyNotOpen;
            els.inicioBtn.textContent = blockInicio ? '✓ En proceso' : 'INICIO';
            els.inicioBtn.disabled = blockInicio;
            els.inicioBtn.classList.toggle('button-done', blockInicio);
        }

        if (els.finBtn) {
            const blockFin = selectedRecords.length === 0 || !anyOpen;
            els.finBtn.textContent = blockFin ? '— FIN —' : 'FIN';
            els.finBtn.disabled = blockFin;
            els.finBtn.classList.toggle('button-done', blockFin);
        }
    }

    function updateSelected(recordId, checked) {
        if (!recordId) return;
        if (checked) { state.selectedIds.add(recordId); } else { state.selectedIds.delete(recordId); }
        renderResults();
    }

    function toggleSelected(recordId) {
        if (!recordId) return;
        updateSelected(recordId, !state.selectedIds.has(recordId));
    }

    function toggleSelectAll() {
        const selectableIds = getSelectableVisibleIds();
        if (!selectableIds.length) return;
        const allSelected = selectableIds.every((id) => state.selectedIds.has(id));
        if (allSelected) {
            selectableIds.forEach((id) => state.selectedIds.delete(id));
        } else {
            selectableIds.forEach((id) => state.selectedIds.add(id));
        }
        renderResults();
    }

    function search(query) {
        state.currentQuery = String(query || '').trim().toUpperCase();
        renderResults();
    }

    async function handleScan() {
        const els = getElements();
        if (!window.TintoreriaQR || typeof TintoreriaQR.scanQrCode !== 'function') {
            showToast('No se encontro el lector QR.');
            return;
        }
        if (els.scanButton) els.scanButton.disabled = true;
        try {
            const rawValue = await TintoreriaQR.scanQrCode();
            const opPartida = TintoreriaQR.normalizeScannedOpPartida(rawValue);
            els.searchInput.value = opPartida;
            search(opPartida);
        } catch (error) {
            const message = error && error.message ? error.message : 'No se pudo escanear el QR.';
            if (message !== 'Escaneo cancelado.') showToast(message);
        } finally {
            if (els.scanButton) els.scanButton.disabled = false;
        }
    }

    function mergeUpdatedRecord(updatedRecord) {
        if (!updatedRecord || !updatedRecord.id_registro) return;
        const targetId = String(updatedRecord.id_registro);
        state.records = state.records.map((r) => {
            if (String(r.id_registro || '') !== targetId) return r;
            return TintoreriaUtils.defaultRecord({ ...r, ...updatedRecord });
        });
    }

    async function handleInicio() {
        const els = getElements();
        const operario = String(els.operarioInput ? els.operarioInput.value : '').trim().toUpperCase();
        const turno = calculateTurno();
        els.turnoInput.value = turno;
        const ahora = TintoreriaUtils.formatProcessDateTime(new Date());

        if (!operario) {
            showToast('Ingresa el operario antes de registrar el inicio.');
            if (els.operarioInput) els.operarioInput.focus();
            return;
        }

        const updates = Array.from(state.selectedIds)
            .map((recordId) => {
                const record = findRecordById(recordId);
                if (!record || hasOpenPass(record)) return null;
                return {
                    id_registro: recordId,
                    changes: {
                        secado_turno: turno,
                        secado_operario: operario,
                        secado_inicio: ahora,
                        secado_estado: 'PROG'
                    }
                };
            })
            .filter(Boolean);

        if (!updates.length) {
            showToast('Las filas seleccionadas ya tienen un proceso abierto. Registra el FIN primero.');
            return;
        }

        els.inicioBtn.disabled = true;
        els.inicioBtn.textContent = 'Guardando...';

        try {
            const response = await TintoreriaAPI.updateRecords(updates);
            (response.records || []).forEach(mergeUpdatedRecord);
            renderResults();
            showToast(`Inicio registrado en ${updates.length} fila(s).`);
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo registrar el inicio.');
        } finally {
            updateActionButtons();
        }
    }

    async function handleFin() {
        const els = getElements();
        const ahora = TintoreriaUtils.formatProcessDateTime(new Date());

        const updates = Array.from(state.selectedIds)
            .map((recordId) => {
                const record = findRecordById(recordId);
                if (!record || !hasOpenPass(record)) return null;
                return {
                    id_registro: recordId,
                    changes: {
                        secado_fin: ahora,
                        secado_estado: 'OK',
                        rama_tenido_estado: 'X PROCESAR'
                    }
                };
            })
            .filter(Boolean);

        if (!updates.length) {
            showToast('Las filas seleccionadas no tienen un proceso abierto para cerrar.');
            return;
        }

        els.finBtn.disabled = true;
        els.finBtn.textContent = 'Guardando...';

        try {
            const response = await TintoreriaAPI.updateRecords(updates);
            (response.records || []).forEach(mergeUpdatedRecord);
            renderResults();
            showToast(`Fin registrado en ${updates.length} fila(s).`);
        } catch (error) {
            showToast(error && error.message ? error.message : 'No se pudo registrar el fin.');
        } finally {
            updateActionButtons();
        }
    }

    function isEditableTarget(target) {
        return target instanceof Element &&
            Boolean(target.closest('input, textarea, select, [contenteditable="true"], label'));
    }

    function dismissKeyboardIfNeeded(target) {
        if (isEditableTarget(target)) return;
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return;
        if (!active.matches('input, textarea, select, [contenteditable="true"]')) return;
        active.blur();
    }

    function bindEvents() {
        const els = getElements();
        if (!els.form || !els.searchInput || !els.resultList || !els.inicioBtn || !els.finBtn || !els.selectAllBtn) return;

        document.addEventListener('pointerdown', (event) => {
            dismissKeyboardIfNeeded(event.target);
        });

        els.form.addEventListener('submit', (event) => {
            event.preventDefault();
            search(els.searchInput.value);
        });

        els.searchInput.addEventListener('input', () => {
            search(els.searchInput.value);
        });

        els.resultList.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) return;
            if (!target.classList.contains('secado-mobile-checkbox')) return;
            updateSelected(target.dataset.recordId || '', target.checked);
        });

        els.resultList.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('.checkbox-label') || target.closest('.secado-mobile-checkbox')) return;
            const card = target.closest('.record-card-selectable');
            if (!card) return;
            toggleSelected(card.getAttribute('data-record-id') || '');
        });

        els.selectAllBtn.addEventListener('click', toggleSelectAll);
        els.inicioBtn.addEventListener('click', handleInicio);
        els.finBtn.addEventListener('click', handleFin);
        if (els.scanButton) els.scanButton.addEventListener('click', handleScan);

        const turno = calculateTurno();
        els.turnoInput.value = turno;
    }

    async function hydrateFromCache() {
        if (!window.TintoreriaAPI || typeof TintoreriaAPI.getCachedRecords !== 'function') return false;
        const cached = TintoreriaAPI.getCachedRecords();
        if (!cached || !Array.isArray(cached.records) || !cached.records.length) return false;
        setRecords(cached.records);
        setSyncStatus(`Mostrando cache local (${cached.records.length} registros). Sincronizando...`);
        renderResults();
        return true;
    }

    async function refreshRemoteRecords() {
        if (!window.TintoreriaAPI || typeof TintoreriaAPI.listRecords !== 'function') {
            setSyncStatus('No se encontro la API configurada.', true);
            return;
        }
        state.syncing = true;
        setSyncStatus('Sincronizando datos con la web...');
        try {
            const response = await TintoreriaAPI.listRecords();
            setRecords(response.records || []);
            renderResults();
            setSyncStatus('');
        } catch (error) {
            setSyncStatus(error && error.message ? error.message : 'No se pudo sincronizar la informacion.', true);
        } finally {
            state.syncing = false;
        }
    }

    // --- Auto-refresh: vuelve a consultar el Sheet sin recargar la pagina ---

    const AUTO_REFRESH_MIN_INTERVAL_MS = 15000;
    let lastAutoRefreshAt = 0;
    let autoRefreshInFlight = false;

    async function requestAutoRefresh() {
        const now = Date.now();
        if (autoRefreshInFlight || now - lastAutoRefreshAt < AUTO_REFRESH_MIN_INTERVAL_MS) return;
        autoRefreshInFlight = true;
        lastAutoRefreshAt = now;
        try {
            await refreshRemoteRecords();
        } finally {
            autoRefreshInFlight = false;
        }
    }

    function bindAutoRefreshEvents() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') requestAutoRefresh();
        });
        window.addEventListener('pageshow', (event) => {
            if (event.persisted) requestAutoRefresh();
        });
    }

    async function init() {
        bindEvents();
        bindAutoRefreshEvents();
        await hydrateFromCache();
        await refreshRemoteRecords();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
