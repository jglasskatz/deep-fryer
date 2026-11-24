import { DoughnutRenderer } from './doughnut-renderer.js';
import { clampSliderProgress, interpolatePolicyLevels } from './portrait-presentation.js';

const CANVAS_SIZE = 560;

function progressLabel(progress) {
  if (progress === 0) return 'Before (baseline portrait)';
  if (progress === 100) return 'With policy (illustrative)';
  return `Comparing (${progress}% toward observed shift)`;
}

function initPolicySlider() {
  const dataEl = document.getElementById('policy-slider-data');
  const root = document.getElementById('policy-slider');
  if (!dataEl || !root) return;

  const policies = JSON.parse(dataEl.textContent);
  if (!Array.isArray(policies) || !policies.length) return;

  const canvas = root.querySelector('#policy-doughnut');
  const slider = root.querySelector('#policy-range');
  const stateEl = root.querySelector('#policy-state');
  const activeViewEl = root.querySelector('#policy-active-view');
  const beforeBtn = root.querySelector('[data-policy-preset="0"]');
  const afterBtn = root.querySelector('[data-policy-preset="100"]');
  const tabs = [...root.querySelectorAll('[data-policy-id]')];

  const placeEl = root.querySelector('#policy-place');
  const yearEl = root.querySelector('#policy-year');
  const gradeEl = root.querySelector('#policy-grade');
  const titleEl = root.querySelector('#policy-title');
  const scopeEl = root.querySelector('#policy-scope');
  const mechanismEl = root.querySelector('#policy-mechanism');
  const baselineBox = root.querySelector('#policy-baseline-box');
  const baselineEl = root.querySelector('#policy-baseline');
  const shiftBox = root.querySelector('#policy-shift-box');
  const shiftEl = root.querySelector('#policy-shift');
  const impactsEl = root.querySelector('#policy-impacts');
  const caveatEl = root.querySelector('#policy-caveat');
  const sourceEl = root.querySelector('#policy-source');

  let currentId = policies[0].id;
  let progress = clampSliderProgress(slider?.value ?? 0);
  let renderer = null;

  function currentPolicy() {
    return policies.find((p) => p.id === currentId) || policies[0];
  }

  function buildRenderer() {
    renderer?.destroy();
    renderer = new DoughnutRenderer({
      canvas,
      size: CANVAS_SIZE,
      pixelRatio: Math.min(3, Math.max(1, window.devicePixelRatio || 1)),
      donutScale: 1.0,
      textSize: Math.round((CANVAS_SIZE / 640) * 13),
    });
    renderer.setColours(2, 1, '#883251', '#E096C6');
  }

  function renderLevels() {
    const policy = currentPolicy();
    if (!renderer) buildRenderer();
    renderer.setLevels(interpolatePolicyLevels(policy, progress));
    const status = progressLabel(progress);
    stateEl.textContent = status;
    activeViewEl.textContent = progress < 50 ? policy.sliderReadout.before : policy.sliderReadout.after;
    slider.value = String(progress);
    slider.setAttribute(
      'aria-valuetext',
      progress === 0
        ? `Before policy: ${policy.sliderReadout.before}`
        : progress === 100
          ? `With policy: ${policy.sliderReadout.after}`
          : `${progress}% between baseline and observed shift`,
    );
    beforeBtn.setAttribute('aria-pressed', String(progress === 0));
    afterBtn.setAttribute('aria-pressed', String(progress === 100));
    baselineBox.dataset.active = String(progress === 0);
    shiftBox.dataset.active = String(progress > 0);
    canvas.setAttribute(
      'aria-label',
      `${policy.place} doughnut showing ${policy.title} (${status}). Highlighted dimensions: ${policy.impacts.map((i) => i.name).join(', ')}.`,
    );
  }

  function renderPolicyDetails() {
    const policy = currentPolicy();
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', String(tab.dataset.policyId === policy.id));
    }
    placeEl.textContent = policy.place;
    yearEl.textContent = policy.year;
    gradeEl.textContent = policy.evidenceGrade;
    titleEl.textContent = policy.title;
    scopeEl.textContent = `${policy.jurisdiction} · ${policy.evidenceKind}`;
    mechanismEl.textContent = policy.mechanism;
    baselineEl.textContent = policy.baselineMetric;
    shiftEl.textContent = policy.observedShift;
    caveatEl.textContent = policy.caveat;
    sourceEl.textContent = `${policy.source.title} ↗`;
    sourceEl.href = policy.source.url;

    impactsEl.replaceChildren();
    for (const impact of policy.impacts) {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'policy-impact-head';
      const strong = document.createElement('strong');
      strong.textContent = impact.name;
      const badge = document.createElement('span');
      badge.className = `policy-direction ${impact.direction}`;
      badge.textContent = impact.direction === 'improves' ? 'Directional improvement' : 'Mixed / tradeoff';
      head.append(strong, badge);
      const note = document.createElement('p');
      note.textContent = impact.note;
      li.append(head, note);
      impactsEl.append(li);
    }

    buildRenderer();
    renderLevels();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (tab.dataset.policyId === currentId) return;
      currentId = tab.dataset.policyId;
      renderPolicyDetails();
    });
  }

  slider.addEventListener('input', () => {
    progress = clampSliderProgress(slider.value);
    renderLevels();
  });

  beforeBtn.addEventListener('click', () => {
    progress = 0;
    renderLevels();
  });

  afterBtn.addEventListener('click', () => {
    progress = 100;
    renderLevels();
  });

  window.addEventListener('pagehide', () => renderer?.destroy(), { once: true });
  renderPolicyDetails();
}

if (typeof document !== 'undefined') {
  initPolicySlider();
}
