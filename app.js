// App state
let currentJurisdiction = "santacruz";
let myDonut = null;
let currentData = null;

// Map dimension names to data objects for detail panel lookup
let dimensionDataMap = {};

// --- Dark mode ---
function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    document.getElementById('themeIcon').innerHTML = isDark ? '&#9788;' : '&#9790;';
    // Reload doughnut to pick up canvas background
    loadDoughnut(currentJurisdiction);
}

// Init theme from localStorage
(function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (saved === 'dark' || (!saved && prefersDark)) {
        document.documentElement.classList.add('dark');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.innerHTML = '&#9788;';
    }
})();

// --- Status helpers ---
function getStatusClass(level) {
    if (typeof level === 'string' || isNaN(level)) return 'status-unknown';
    if (level <= -50) return 'status-good';
    if (level <= 0) return 'status-caution';
    if (level <= 50) return 'status-caution';
    if (level <= 100) return 'status-bad';
    return 'status-severe';
}

function getStatusLabel(level) {
    if (typeof level === 'string' || isNaN(level)) return 'Unknown';
    if (level <= -100) return 'No problem';
    if (level <= -50) return 'Under control';
    if (level <= 0) return 'On track';
    if (level <= 50) return 'Needs attention';
    if (level <= 100) return 'Critical';
    return 'Severe';
}

// --- Summary strip ---
function updateSummaryStrip(data) {
    const strip = document.getElementById('summaryStrip');
    if (!strip) return;

    const all = [...(data.social || []), ...(data.ecological || [])];
    let good = 0, caution = 0, bad = 0, unknown = 0;
    all.forEach(d => {
        const l = d.level;
        if (typeof l !== 'number' || isNaN(l)) unknown++;
        else if (l <= 0) good++;
        else if (l <= 50) caution++;
        else bad++;
    });

    strip.innerHTML = `
        <span class="summary-chip chip-good">${good} thriving</span>
        <span class="summary-chip chip-caution">${caution} needs attention</span>
        <span class="summary-chip chip-bad">${bad} critical</span>
        ${unknown ? `<span class="summary-chip chip-unknown">${unknown} unknown</span>` : ''}
    `;
}

// --- Dynamic doughnut sizing ---
function getDoughnutSize() {
    const container = document.getElementById('doughnutDiv');
    const availW = container.clientWidth;
    // Leave room for header (~56px), info (~60px), hint+chips+links (~90px)
    const availH = window.innerHeight - 210;
    const size = Math.min(availW, availH);
    // Clamp between 320 and 800, use devicePixelRatio for crisp rendering
    return Math.max(320, Math.min(size, 800));
}

// --- Load doughnut ---
function loadDoughnut(jurisdictionKey) {
    currentJurisdiction = jurisdictionKey;
    currentData = JURISDICTIONS[jurisdictionKey];
    dimensionDataMap = {};

    // Update header info
    document.getElementById('jurisdictionName').textContent = currentData.name;
    document.getElementById('jurisdictionPop').textContent = 'Population: ' + currentData.population;
    document.getElementById('jurisdictionDesc').textContent = currentData.description;

    // Update active button
    document.querySelectorAll('.jurisdiction-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.key === jurisdictionKey);
    });

    // Dynamic size based on container width
    const size = getDoughnutSize();
    const textSize = Math.max(10, Math.round(14 * (size / 640)));
    myDonut = new Doughnut(size, 1.0, textSize, "doughnutCanvas", "doughnutDiv", null, null, null, null);

    // Set global/local type (colored red gradient for overshoot)
    myDonut.setColours(2, 1, "#883251", "#E096C6");

    // Add social foundation (inner) dimensions
    currentData.social.forEach(dim => {
        dimensionDataMap['inner:' + dim.name] = { ...dim, ring: 'social' };
        myDonut.addDimension("inner", dim.name, dim.level, "");
    });

    // Add ecological ceiling (outer) dimensions
    currentData.ecological.forEach(dim => {
        dimensionDataMap['outer:' + dim.name] = { ...dim, ring: 'ecological' };
        myDonut.addDimension("outer", dim.name, dim.level, "");
    });

    // Update summary
    updateSummaryStrip(currentData);

    // Hide detail panel content
    document.getElementById('detailEmpty').style.display = 'flex';
    document.getElementById('detailContent').style.display = 'none';

    // Re-attach click interceptor since canvas is recreated
    setupClickInterceptor();
}

// --- Detail panel ---
function showDetail(dimType, dimName) {
    const key = dimType + ':' + dimName;
    const data = dimensionDataMap[key];
    if (!data) return;

    const content = document.getElementById('detailContent');
    const isEco = data.ring === 'ecological';

    let html = '';

    // Header
    html += '<div class="detail-header">';
    html += `<span class="detail-ring ${isEco ? 'ring-ecological' : 'ring-social'}"></span>`;
    html += `<h3>${data.name}</h3>`;
    html += `<span class="detail-status ${getStatusClass(data.level)}">${getStatusLabel(data.level)}</span>`;
    html += '</div>';

    // Severity bar
    if (typeof data.level === 'number' && !isNaN(data.level)) {
        const pct = Math.min(100, Math.max(0, (data.level + 100) / 2.5));
        const barColor = data.level <= -50 ? '#22c55e' : data.level <= 0 ? '#84cc16' : data.level <= 50 ? '#eab308' : data.level <= 100 ? '#ef4444' : '#dc2626';
        html += `<div style="background:var(--border);border-radius:4px;height:6px;margin-bottom:0.75rem;overflow:hidden;">`;
        html += `<div style="width:${pct}%;height:100%;border-radius:4px;background:${barColor};transition:width 0.4s ease;"></div>`;
        html += `</div>`;
    }

    // Metric card
    html += '<div class="detail-metric">';
    html += `<div class="label">${data.indicator || 'Indicator'}</div>`;
    html += `<div class="value">${data.value || 'Data needed'}</div>`;
    if (data.year) html += `<div class="year">Year: ${data.year}</div>`;
    if (data.target) html += `<div class="target">Target: ${data.target}</div>`;
    if (data.context) html += `<div class="context">${data.context}</div>`;
    html += '</div>';

    // Source
    if (data.source) {
        html += '<div class="detail-source">';
        html += '<h4>Primary Source</h4>';
        if (data.sourceUrl) {
            html += `<a href="${data.sourceUrl}" target="_blank" rel="noopener">${data.source}</a>`;
        } else {
            html += `<span style="font-size:0.85rem;color:var(--text-muted)">${data.source}</span>`;
        }
        if (data.screenshot) {
            html += `<img class="source-screenshot" src="${data.screenshot}" alt="Source document" onclick="openLightbox('${data.screenshot}')">`;
        }
        html += '</div>';
    }

    // Actions
    if (data.actions && data.actions.length > 0) {
        html += '<div class="detail-actions">';
        html += '<h4>Ways to Get Involved</h4>';
        html += '<ul>';
        data.actions.forEach(action => {
            html += `<li>${action}</li>`;
        });
        html += '</ul>';
        html += '</div>';
    }


    content.innerHTML = html;
    document.getElementById('detailEmpty').style.display = 'none';
    content.style.display = 'block';
}

function openLightbox(src) {
    document.getElementById('lightboxImg').src = src;
    document.getElementById('lightbox').classList.add('active');
}

// Close lightbox on click
document.getElementById('lightbox').addEventListener('click', () => {
    document.getElementById('lightbox').classList.remove('active');
});

// Intercept canvas clicks for dimension detail
function setupClickInterceptor() {
    const canvas = document.getElementById('doughnutCanvas');
    canvas.addEventListener('click', () => {
        setTimeout(() => {
            const dim = myDonut.getSelectedDimension();
            if (dim) {
                showDetail(dim.type, dim.name);
            }
        }, 50);
    });
}

// Jurisdiction switcher buttons
document.querySelectorAll('.jurisdiction-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        loadDoughnut(btn.dataset.key);
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') loadDoughnut('santacruz');
    if (e.key === '2') loadDoughnut('sc-county');
    if (e.key === '3') loadDoughnut('watsonville');
    if (e.key === 'd') toggleTheme();
});

// Initialize
loadDoughnut('santacruz');
setupClickInterceptor();

// Resize doughnut on window resize (debounced)
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => loadDoughnut(currentJurisdiction), 200);
});
