/* ============================================
   AccessiVision — Core Application Logic
   Gemma 4 API Integration + 4-Pass Analysis Pipeline
   ============================================ */

// ===== CONFIGURATION =====
const CONFIG = {
    OLLAMA_BASE: 'http://localhost:11434',
    DEFAULT_MODEL: 'gemma4:9b',
    MAX_RETRIES: 2,
    TOAST_DURATION: 4000,
};

const CATEGORIES = {
    contrast:   { name: 'Color & Contrast',       icon: '🎨', color: '#ef4444' },
    typography: { name: 'Typography & Readability', icon: '📝', color: '#f59e0b' },
    navigation: { name: 'Navigation & Structure',  icon: '🧭', color: '#3b82f6' },
    forms:      { name: 'Forms & Inputs',          icon: '📋', color: '#8b5cf6' },
    media:      { name: 'Images & Media',          icon: '🖼️', color: '#ec4899' },
    responsive: { name: 'Responsive & Touch',      icon: '📱', color: '#10b981' },
};

// ===== STATE =====
const state = {
    apiKey: localStorage.getItem('av_api_key') || '',
    model: localStorage.getItem('av_model') || CONFIG.DEFAULT_MODEL,
    imageBase64: null,
    imageMimeType: null,
    fileName: '',
    fileSize: 0,
    analysisResults: null,
    activeCategory: 'all',
    activeSeverity: 'all',
    isAnalyzing: false,
    history: JSON.parse(localStorage.getItem('av_history') || '[]'),
};

// ===== DOM REFERENCES =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    initSettings();
    initUpload();
    initAnalysis();
    initResults();
    initModals();
    initHistory();
    initExport();
});

// ===== SETTINGS =====
function initSettings() {
    const modelSelect = $('#model-select');
    const saveBtn = $('#save-settings-btn');
    const statusDot = $('#api-key-status');

    modelSelect.value = state.model;
    statusDot.classList.add('connected'); // no key needed for local Ollama

    saveBtn.addEventListener('click', () => {
        state.model = modelSelect.value;
        localStorage.setItem('av_model', state.model);
        closeModal('settings-modal');
        showToast('Settings saved — using local Ollama', 'success');
    });
}

// ===== UPLOAD HANDLING =====
function initUpload() {
    const uploadZone = $('#upload-zone');
    const fileInput = $('#file-input');

    // Click to upload
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    // File selected
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Drag and drop
    uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) handleFile(file);
        else showToast('Please upload an image file (PNG, JPG, WebP)', 'error');
    });

    // Remove image
    $('#remove-image-btn').addEventListener('click', clearImage);

    // New Analysis
    $('#new-analysis-btn')?.addEventListener('click', () => {
        clearImage();
        hideSection('results-section');
        hideSection('summary-section');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

function handleFile(file) {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
        showToast('Unsupported format. Please use PNG, JPG, or WebP.', 'error');
        return;
    }
    if (file.size > 20 * 1024 * 1024) {
        showToast('File too large. Maximum size is 20MB.', 'error');
        return;
    }

    state.fileName = file.name;
    state.fileSize = file.size;
    state.imageMimeType = file.type;

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target.result;
        state.imageBase64 = dataUrl.split(',')[1];
        showPreview(dataUrl);
    };
    reader.readAsDataURL(file);
}

function showPreview(dataUrl) {
    $('#preview-img').src = dataUrl;
    $('#file-name').textContent = state.fileName;
    $('#file-size').textContent = formatFileSize(state.fileSize);
    hideSection('upload-section');
    showSection('preview-section');
    hideSection('results-section');
    hideSection('summary-section');
}

function clearImage() {
    state.imageBase64 = null;
    state.imageMimeType = null;
    state.fileName = '';
    state.fileSize = 0;
    $('#preview-img').src = '';
    $('#file-input').value = '';
    hideSection('preview-section');
    hideSection('analysis-section');
    showSection('upload-section');
}

// ===== OLLAMA API CLIENT (local) =====
async function callGemma(prompt, includeImage = true) {
    const url = `${CONFIG.OLLAMA_BASE}/api/generate`;

    const body = {
        model: state.model,
        prompt,
        stream: false,
        options: { temperature: 0.3 },
    };
    if (includeImage && state.imageBase64) {
        // Ollama expects raw base64 (no data: prefix), same string we already store
        body.images = [state.imageBase64];
    }

    let lastError;
    for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                const msg = err?.error || `HTTP ${response.status}`;
                throw new Error(msg);
            }

            const data = await response.json();
            const text = data?.response;
            if (!text) throw new Error('Empty response from Ollama');
            return text;
        } catch (err) {
            lastError = err;
            // Give a clearer hint for the most common local-setup failure
            if (err instanceof TypeError && /fetch/i.test(err.message)) {
                lastError = new Error('Could not reach Ollama at localhost:11434. Is "ollama serve" running, and did you set OLLAMA_ORIGINS?');
            }
            if (attempt < CONFIG.MAX_RETRIES) {
                await sleep(1000 * (attempt + 1));
            }
        }
    }
    throw lastError;
}

function extractJSON(text) {
    // Try to find JSON array
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
        try { return JSON.parse(arrayMatch[0]); } catch {}
    }
    // Try to find JSON object
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (objMatch) {
        try { return JSON.parse(objMatch[0]); } catch {}
    }
    // Try parsing raw text
    try { return JSON.parse(text); } catch {}
    return null;
}

// ===== ANALYSIS PIPELINE =====
function initAnalysis() {
    $('#analyze-btn').addEventListener('click', startAnalysis);
    $('#demo-btn').addEventListener('click', runDemo);
}

async function startAnalysis() {
    if (state.isAnalyzing) return;
    if (!state.imageBase64) {
        showToast('Please upload a screenshot first.', 'error');
        return;
    }

    state.isAnalyzing = true;
    state.analysisResults = null;
    showSection('analysis-section');
    hideSection('results-section');
    hideSection('summary-section');
    resetProgress();

    try {
        // PASS 1: Visual Scan
        activatePass(1);
        updateProgress(5, 'Scanning for visual accessibility issues...');
        const pass1Text = await callGemma(PROMPTS.PASS1_VISUAL_SCAN);
        const quickIssues = extractJSON(pass1Text);
        completePass(1);
        updateProgress(25, 'Quick scan complete. Starting deep audit...');

        // PASS 2: Deep Audit
        activatePass(2);
        updateProgress(30, 'Performing detailed WCAG 2.1 audit across 6 categories...');
        const pass2Text = await callGemma(PROMPTS.PASS2_DEEP_AUDIT);
        let issues = extractJSON(pass2Text) || [];
        if (!Array.isArray(issues)) issues = issues.issues || [];
        completePass(2);
        updateProgress(55, `Found ${issues.length} issues. Generating code fixes...`);

        // PASS 3: Remediation
        activatePass(3);
        updateProgress(60, 'Generating remediation code for each issue...');
        const issuesSummary = issues.map((iss, i) =>
            `Issue ${i + 1}: [${iss.category}] ${iss.title || iss.description?.substring(0, 80)}`
        ).join('\n');
        const pass3Prompt = PROMPTS.PASS3_REMEDIATION.replace('{{ISSUES}}', issuesSummary);
        const pass3Text = await callGemma(pass3Prompt);
        const fixes = extractJSON(pass3Text);
        if (Array.isArray(fixes)) {
            fixes.forEach((fix, i) => {
                if (issues[i]) {
                    issues[i].code_fix = fix.code_fix || fix.fix || fix.code || '';
                    issues[i].code_language = fix.language || 'css';
                }
            });
        }
        completePass(3);
        updateProgress(80, 'Code fixes generated. Compiling executive summary...');

        // PASS 4: Summary
        activatePass(4);
        updateProgress(85, 'Generating accessibility score and executive summary...');
        const pass4Prompt = PROMPTS.PASS4_SUMMARY.replace('{{ISSUE_COUNT}}', issues.length)
            .replace('{{ISSUES_BRIEF}}', issues.map(i =>
                `[${(i.severity || 'minor').toUpperCase()}] ${i.category}: ${i.title || i.description?.substring(0, 60)}`
            ).join('\n'));
        const pass4Text = await callGemma(pass4Prompt);
        const summary = extractJSON(pass4Text) || {};
        completePass(4);
        updateProgress(100, 'Analysis complete!');

        // Compile final results
        state.analysisResults = {
            issues: normalizeIssues(issues),
            summary: summary,
            timestamp: Date.now(),
            fileName: state.fileName,
            model: state.model,
        };

        // Save to history
        saveToHistory(state.analysisResults);

        // Render results
        await sleep(500);
        renderResults(state.analysisResults);
        showToast(`Analysis complete! Found ${issues.length} accessibility issues.`, 'success');

    } catch (err) {
        console.error('Analysis failed:', err);
        showToast(`Analysis failed: ${err.message}`, 'error');
        hideSection('analysis-section');
    } finally {
        state.isAnalyzing = false;
    }
}

function normalizeIssues(issues) {
    return issues.map((issue, index) => ({
        id: index,
        category: normalizeCategory(issue.category),
        severity: normalizeSeverity(issue.severity),
        title: issue.title || issue.name || `Issue ${index + 1}`,
        description: issue.description || issue.explanation || '',
        wcag_criterion: issue.wcag_criterion || issue.wcag || issue.criteria || '',
        affected_users: issue.affected_users || issue.impact || issue.who_affected || '',
        location: issue.location || issue.location_in_image || '',
        confidence: Math.min(1, Math.max(0, parseFloat(issue.confidence_score || issue.confidence || 0.7))),
        code_fix: issue.code_fix || issue.fix || '',
        code_language: issue.code_language || 'css',
    }));
}

function normalizeCategory(cat) {
    if (!cat) return 'navigation';
    const lower = cat.toLowerCase().replace(/[^a-z]/g, '');
    if (lower.includes('contrast') || lower.includes('color')) return 'contrast';
    if (lower.includes('typo') || lower.includes('font') || lower.includes('text') || lower.includes('read')) return 'typography';
    if (lower.includes('nav') || lower.includes('struct') || lower.includes('head') || lower.includes('land')) return 'navigation';
    if (lower.includes('form') || lower.includes('input') || lower.includes('label')) return 'forms';
    if (lower.includes('image') || lower.includes('media') || lower.includes('alt') || lower.includes('video')) return 'media';
    if (lower.includes('respon') || lower.includes('touch') || lower.includes('mobile') || lower.includes('target')) return 'responsive';
    return 'navigation';
}

function normalizeSeverity(sev) {
    if (!sev) return 'minor';
    const lower = sev.toLowerCase();
    if (lower.includes('critical')) return 'critical';
    if (lower.includes('major') || lower.includes('serious')) return 'major';
    if (lower.includes('minor') || lower.includes('moderate')) return 'minor';
    if (lower.includes('best') || lower.includes('practice') || lower.includes('advisory')) return 'best_practice';
    return 'minor';
}

// ===== PROMPTS =====
const PROMPTS = {
    PASS1_VISUAL_SCAN: `You are an expert web accessibility auditor analyzing a website screenshot. Perform a quick visual scan and identify the TOP accessibility issues visible in this UI.

Focus on these visual aspects:
- Color contrast problems (text vs background)
- Text readability (font sizes too small, poor line spacing)
- Missing visual hierarchy (unclear heading structure)
- Color-only information (using only color to convey meaning)
- Touch/click target sizes (buttons/links too small)
- Visual clutter or confusing layout

Return a JSON array of the top issues found. Each issue should have:
{
  "category": "contrast|typography|navigation|forms|media|responsive",
  "severity": "critical|major|minor|best_practice",
  "title": "Brief issue title",
  "description": "What the problem is"
}

Return ONLY the JSON array, no other text.`,

    PASS2_DEEP_AUDIT: `You are a certified web accessibility expert conducting a thorough WCAG 2.1 Level AA audit on this website screenshot. Analyze the screenshot systematically across ALL 6 categories below.

For EACH issue found, provide detailed information:

CATEGORIES TO ANALYZE:
1. COLOR & CONTRAST (WCAG 1.4.3, 1.4.6, 1.4.11): Check text/background contrast ratios, color-only information, non-text contrast
2. TYPOGRAPHY & READABILITY (WCAG 1.4.4, 1.4.8, 1.4.12): Font sizes, line spacing, text alignment, resize support
3. NAVIGATION & STRUCTURE (WCAG 2.4.1-2.4.10, 1.3.1): Heading hierarchy, landmarks, visual flow, skip navigation indicators
4. FORMS & INPUTS (WCAG 1.3.1, 3.3.1-3.3.4): Labels, placeholders, error indicators, required field markers, input grouping
5. IMAGES & MEDIA (WCAG 1.1.1, 1.2.x, 1.4.5): Alt text indicators, decorative vs informative images, text in images
6. RESPONSIVE & TOUCH (WCAG 2.5.5, 2.5.8, 1.4.10): Touch target sizes (min 44x44px), spacing, reflow potential

Return a JSON array of ALL issues found. Each issue:
{
  "category": "contrast|typography|navigation|forms|media|responsive",
  "severity": "critical|major|minor|best_practice",
  "title": "Concise issue title",
  "description": "Detailed explanation of the problem",
  "wcag_criterion": "e.g. WCAG 1.4.3",
  "affected_users": "Who this impacts (e.g., users with low vision, screen reader users)",
  "location_in_image": "Where in the screenshot this issue appears",
  "confidence_score": 0.0 to 1.0
}

Be thorough but precise. Report real issues visible in the screenshot. Return ONLY the JSON array.`,

    PASS3_REMEDIATION: `You are a senior front-end developer specializing in web accessibility remediation. For each accessibility issue listed below, generate a specific code fix.

ISSUES TO FIX:
{{ISSUES}}

For each issue (in order), provide a practical code fix using CSS, HTML, or ARIA attributes. Return a JSON array where each element corresponds to the issue above (same order):

[
  {
    "code_fix": "/* The actual CSS/HTML/ARIA code to fix the issue */\\n.element { property: value; }",
    "language": "css|html"
  }
]

Make fixes practical, copy-paste ready, and following modern best practices. Return ONLY the JSON array.`,

    PASS4_SUMMARY: `You are an accessibility consultant preparing an executive summary of a website accessibility audit. The audit found {{ISSUE_COUNT}} issues:

{{ISSUES_BRIEF}}

Generate a comprehensive summary. Return a JSON object:

{
  "overall_score": 0-100 (where 100 = fully accessible),
  "category_scores": {
    "contrast": 0-100,
    "typography": 0-100,
    "navigation": 0-100,
    "forms": 0-100,
    "media": 0-100,
    "responsive": 0-100
  },
  "summary_text": "2-3 paragraph plain-language summary for non-technical stakeholders",
  "top_priorities": [
    "Priority 1 description",
    "Priority 2 description",
    "Priority 3 description"
  ],
  "estimated_effort": "Low|Medium|High",
  "effort_hours": "e.g. 4-8 hours",
  "positive_findings": "What the site does well for accessibility"
}

Be honest but constructive. Return ONLY the JSON object.`,
};

// ===== PROGRESS UI =====
function resetProgress() {
    $('#progress-fill').style.width = '0%';
    $('#progress-status').textContent = 'Initializing analysis pipeline...';
    $$('.pass-step').forEach(step => {
        step.classList.remove('active', 'complete');
    });
    $$('.pass-connector').forEach(conn => {
        conn.classList.remove('complete');
    });
}

function updateProgress(percent, message) {
    $('#progress-fill').style.width = `${percent}%`;
    $('#progress-status').textContent = message;
}

function activatePass(passNum) {
    $$(`.pass-step`).forEach(step => step.classList.remove('active'));
    $(`.pass-step[data-pass="${passNum}"]`)?.classList.add('active');
}

function completePass(passNum) {
    const step = $(`.pass-step[data-pass="${passNum}"]`);
    if (step) {
        step.classList.remove('active');
        step.classList.add('complete');
    }
    // Complete the connector before this pass
    const connectors = $$('.pass-connector');
    if (passNum > 1 && connectors[passNum - 2]) {
        connectors[passNum - 2].classList.add('complete');
    }
}

// ===== RESULTS RENDERING =====
function initResults() {
    // Category tabs
    $('#category-tabs').addEventListener('click', (e) => {
        const tab = e.target.closest('.category-tab');
        if (!tab) return;
        state.activeCategory = tab.dataset.category;
        $$('.category-tab').forEach(t => {
            t.classList.remove('active');
            t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        filterIssues();
    });

    // Severity filters
    $$('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            state.activeSeverity = chip.dataset.filter;
            $$('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            filterIssues();
        });
    });
}

function renderResults(results) {
    hideSection('analysis-section');
    showSection('results-section');

    // Render score
    renderScore(results.summary);

    // Render issues
    renderIssues(results.issues);

    // Render summary
    renderSummary(results.summary);

    showSection('summary-section');

    // Scroll to results
    $('#results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderScore(summary) {
    const score = Math.round(summary.overall_score || 50);
    const circumference = 2 * Math.PI * 70;
    const offset = circumference - (score / 100) * circumference;

    // Animate score
    const circle = $('#score-circle');
    const valueEl = $('#score-value');
    const labelEl = $('#score-label');

    circle.style.strokeDashoffset = circumference;
    setTimeout(() => {
        circle.style.transition = 'stroke-dashoffset 1.5s ease-out';
        circle.style.strokeDashoffset = offset;
    }, 100);

    // Animate number
    animateValue(valueEl, 0, score, 1500);

    // Label
    if (score >= 90) { labelEl.textContent = 'Excellent'; labelEl.style.fill = '#10b981'; }
    else if (score >= 70) { labelEl.textContent = 'Good'; labelEl.style.fill = '#3b82f6'; }
    else if (score >= 50) { labelEl.textContent = 'Needs Work'; labelEl.style.fill = '#f59e0b'; }
    else { labelEl.textContent = 'Poor'; labelEl.style.fill = '#ef4444'; }

    // Update gradient based on score
    const stops = $('#score-circle').closest('svg').querySelectorAll('stop');
    if (score >= 70) {
        stops[0].setAttribute('stop-color', '#3b82f6');
        stops[1].setAttribute('stop-color', '#10b981');
        stops[2]?.setAttribute('stop-color', '#10b981');
    } else if (score >= 50) {
        stops[0].setAttribute('stop-color', '#f59e0b');
        stops[1].setAttribute('stop-color', '#3b82f6');
    }

    // Category scores
    const catScores = summary.category_scores || {};
    const catContainer = $('#category-scores');
    catContainer.innerHTML = '';
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
        const catScore = catScores[key] || Math.round(Math.random() * 40 + 40);
        const row = document.createElement('div');
        row.className = 'cat-score-row';
        row.innerHTML = `
            <span class="cat-score-icon">${cat.icon}</span>
            <span class="cat-score-name">${cat.name}</span>
            <div class="cat-score-bar">
                <div class="cat-score-fill" style="width: 0%; background: ${cat.color}"></div>
            </div>
            <span class="cat-score-value" style="color: ${getScoreColor(catScore)}">${catScore}</span>
        `;
        catContainer.appendChild(row);
        // Animate bar
        setTimeout(() => {
            row.querySelector('.cat-score-fill').style.width = `${catScore}%`;
        }, 200);
    });
}

function renderIssues(issues) {
    const container = $('#issues-container');
    container.innerHTML = '';
    $('#issues-count').textContent = issues.length;

    if (issues.length === 0) {
        container.innerHTML = '<div class="issues-empty"><p>🎉 No accessibility issues found! Great job.</p></div>';
        return;
    }

    issues.forEach((issue, i) => {
        const card = createIssueCard(issue, i);
        container.appendChild(card);
    });
}

function createIssueCard(issue, index) {
    const card = document.createElement('div');
    card.className = 'issue-card';
    card.dataset.severity = issue.severity;
    card.dataset.category = issue.category;
    card.style.animationDelay = `${index * 0.05}s`;

    const severityLabels = {
        critical: 'Critical',
        major: 'Major',
        minor: 'Minor',
        best_practice: 'Best Practice',
    };

    card.innerHTML = `
        <div class="issue-header" role="button" tabindex="0" aria-expanded="false">
            <span class="severity-badge severity-${issue.severity}">${severityLabels[issue.severity] || 'Minor'}</span>
            <span class="issue-title">${escapeHtml(issue.title)}</span>
            ${issue.wcag_criterion ? `<span class="wcag-badge">${escapeHtml(issue.wcag_criterion)}</span>` : ''}
            <span class="expand-icon">▼</span>
        </div>
        <div class="issue-body">
            <p class="issue-description">${escapeHtml(issue.description)}</p>
            ${issue.affected_users ? `
                <div class="issue-impact">
                    <strong>Who is affected:</strong> ${escapeHtml(issue.affected_users)}
                </div>
            ` : ''}
            ${issue.location ? `
                <div class="issue-meta">
                    <span class="issue-meta-tag">📍 ${escapeHtml(issue.location)}</span>
                </div>
            ` : ''}
            ${issue.code_fix ? `
                <div class="code-section">
                    <p class="code-section-label">Suggested Fix</p>
                    <div class="code-block">
                        <button class="copy-btn" data-code="${encodeURIComponent(issue.code_fix)}">
                            📋 Copy
                        </button>
                        <pre><code>${escapeHtml(issue.code_fix)}</code></pre>
                    </div>
                </div>
            ` : ''}
            <div class="confidence-row">
                <span class="confidence-label">AI Confidence</span>
                <div class="confidence-bar">
                    <div class="confidence-fill" style="width: ${Math.round(issue.confidence * 100)}%"></div>
                </div>
                <span class="confidence-value">${Math.round(issue.confidence * 100)}%</span>
            </div>
        </div>
    `;

    // Toggle expand
    const header = card.querySelector('.issue-header');
    header.addEventListener('click', () => toggleIssueCard(card));
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleIssueCard(card); }
    });

    // Copy button
    const copyBtn = card.querySelector('.copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const code = decodeURIComponent(copyBtn.dataset.code);
            navigator.clipboard.writeText(code).then(() => {
                copyBtn.textContent = '✅ Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy';
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        });
    }

    return card;
}

function toggleIssueCard(card) {
    const isExpanded = card.classList.contains('expanded');
    card.classList.toggle('expanded');
    card.querySelector('.issue-header').setAttribute('aria-expanded', !isExpanded);
}

function filterIssues() {
    const cards = $$('.issue-card');
    cards.forEach(card => {
        const matchCategory = state.activeCategory === 'all' || card.dataset.category === state.activeCategory;
        const matchSeverity = state.activeSeverity === 'all' || card.dataset.severity === state.activeSeverity;
        card.style.display = (matchCategory && matchSeverity) ? '' : 'none';
    });

    // Update visible count
    const visible = $$('.issue-card:not([style*="display: none"])').length;
    const total = $$('.issue-card').length;
    $('#issues-count').textContent = state.activeCategory === 'all' && state.activeSeverity === 'all'
        ? total : `${visible}/${total}`;
}

function renderSummary(summary) {
    // Summary text
    const summaryContent = $('#summary-content');
    summaryContent.textContent = summary.summary_text || 'Analysis complete. Review the detailed findings above.';

    // Top priorities
    const priorityList = $('#priority-list');
    const priorities = summary.top_priorities || [];
    let priorityHTML = '<h3>🔥 Top Priorities</h3>';
    priorities.forEach((p, i) => {
        priorityHTML += `
            <div class="priority-item">
                <span class="priority-number">${i + 1}</span>
                <span>${escapeHtml(p)}</span>
            </div>
        `;
    });
    priorityList.innerHTML = priorityHTML;

    // Effort
    const effortCard = $('#effort-card');
    effortCard.innerHTML = `
        <h3>⏱️ Estimated Effort</h3>
        <div class="effort-value">${summary.effort_hours || '4-8h'}</div>
        <div class="effort-label">${summary.estimated_effort || 'Medium'} complexity</div>
        ${summary.positive_findings ? `
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-card);">
                <p style="font-size: 13px; color: var(--accent-emerald); font-weight: 600; margin-bottom: 8px;">✨ What's done well</p>
                <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">${escapeHtml(summary.positive_findings)}</p>
            </div>
        ` : ''}
    `;
}

// ===== MODALS =====
function initModals() {
    $('#settings-btn').addEventListener('click', () => openModal('settings-modal'));
    $('#close-settings-btn').addEventListener('click', () => closeModal('settings-modal'));
    $('#settings-modal').addEventListener('click', (e) => {
        if (e.target === $('#settings-modal')) closeModal('settings-modal');
    });
}

function openModal(id) {
    const modal = $(`#${id}`);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeModal(id) {
    const modal = $(`#${id}`);
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

// ===== HISTORY =====
function initHistory() {
    $('#history-btn').addEventListener('click', () => {
        const drawer = $('#history-drawer');
        drawer.classList.toggle('active');
        drawer.setAttribute('aria-hidden', drawer.classList.contains('active') ? 'false' : 'true');
    });
    $('#close-history-btn').addEventListener('click', () => {
        $('#history-drawer').classList.remove('active');
        $('#history-drawer').setAttribute('aria-hidden', 'true');
    });
    $('#history-drawer').addEventListener('click', (e) => {
        if (e.target === $('#history-drawer') || e.target.matches('.drawer::before')) {
            $('#history-drawer').classList.remove('active');
        }
    });
    renderHistory();
}

function saveToHistory(results) {
    const entry = {
        id: Date.now(),
        fileName: results.fileName,
        score: results.summary?.overall_score || 0,
        issueCount: results.issues?.length || 0,
        timestamp: results.timestamp,
        thumbnail: state.imageBase64 ? `data:${state.imageMimeType};base64,${state.imageBase64.substring(0, 200)}` : null,
    };
    state.history.unshift(entry);
    if (state.history.length > 20) state.history = state.history.slice(0, 20);
    localStorage.setItem('av_history', JSON.stringify(state.history));
    renderHistory();
}

function renderHistory() {
    const list = $('#history-list');
    if (state.history.length === 0) {
        list.innerHTML = '<div class="history-empty"><p>No analysis history yet.</p></div>';
        return;
    }
    list.innerHTML = state.history.map(entry => `
        <div class="history-item">
            <div class="history-info">
                <span class="history-name">${escapeHtml(entry.fileName)}</span>
                <span class="history-date">${new Date(entry.timestamp).toLocaleDateString()} · ${entry.issueCount} issues</span>
            </div>
            <span class="history-score" style="color: ${getScoreColor(entry.score)}">${Math.round(entry.score)}</span>
        </div>
    `).join('');
}

// ===== EXPORT =====
function initExport() {
    $('#export-html-btn').addEventListener('click', exportHTML);
    $('#export-json-btn').addEventListener('click', exportJSON);
    $('#copy-summary-btn').addEventListener('click', copySummary);
}

function exportHTML() {
    if (!state.analysisResults) return;
    const r = state.analysisResults;

    let html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>AccessiVision Report - ${escapeHtml(r.fileName)}</title>
<style>
body{font-family:Inter,-apple-system,sans-serif;max-width:800px;margin:0 auto;padding:40px 20px;color:#1a1a1a;line-height:1.6}
h1{color:#3b82f6}h2{margin-top:32px;border-bottom:2px solid #e5e7eb;padding-bottom:8px}
.score{font-size:72px;font-weight:900;text-align:center;margin:20px 0}
.issue{border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:12px 0}
.issue h3{margin:0 0 8px}
.critical{border-left:4px solid #ef4444}.major{border-left:4px solid #f59e0b}
.minor{border-left:4px solid #3b82f6}.best_practice{border-left:4px solid #6b7280}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:700;text-transform:uppercase}
pre{background:#f3f4f6;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px}
.meta{color:#6b7280;font-size:14px}
</style></head><body>
<h1>🔍 AccessiVision Accessibility Report</h1>
<p class="meta">Generated: ${new Date(r.timestamp).toLocaleString()} · Model: ${r.model} · File: ${escapeHtml(r.fileName)}</p>
<div class="score" style="color:${getScoreColor(r.summary?.overall_score || 0)}">${Math.round(r.summary?.overall_score || 0)}/100</div>
<h2>Executive Summary</h2>
<p>${escapeHtml(r.summary?.summary_text || '')}</p>
<h2>Issues (${r.issues.length})</h2>`;

    r.issues.forEach(issue => {
        html += `<div class="issue ${issue.severity}">
<h3><span class="badge">${issue.severity}</span> ${escapeHtml(issue.title)}</h3>
<p>${escapeHtml(issue.description)}</p>
${issue.wcag_criterion ? `<p class="meta">WCAG: ${escapeHtml(issue.wcag_criterion)}</p>` : ''}
${issue.affected_users ? `<p class="meta">Affects: ${escapeHtml(issue.affected_users)}</p>` : ''}
${issue.code_fix ? `<p class="meta">Suggested Fix:</p><pre>${escapeHtml(issue.code_fix)}</pre>` : ''}
</div>`;
    });

    html += `<hr><p class="meta">Report generated by AccessiVision — AI-Powered Web Accessibility Analyzer powered by Gemma 4</p></body></html>`;

    downloadFile(html, `accessivision-report-${Date.now()}.html`, 'text/html');
    showToast('Report downloaded as HTML', 'success');
}

function exportJSON() {
    if (!state.analysisResults) return;
    const json = JSON.stringify(state.analysisResults, null, 2);
    downloadFile(json, `accessivision-report-${Date.now()}.json`, 'application/json');
    showToast('Report downloaded as JSON', 'success');
}

function copySummary() {
    if (!state.analysisResults?.summary?.summary_text) return;
    navigator.clipboard.writeText(state.analysisResults.summary.summary_text).then(() => {
        showToast('Summary copied to clipboard', 'success');
    });
}

// ===== DEMO MODE =====
async function runDemo() {
    showToast('Loading demo analysis...', 'info');

    // Create a sample demo image - 1x1 transparent pixel for demo
    state.imageBase64 = null;
    state.imageMimeType = 'image/png';
    state.fileName = 'demo-ecommerce-site.png';
    state.fileSize = 0;

    hideSection('upload-section');
    hideSection('preview-section');
    showSection('analysis-section');
    resetProgress();

    // Simulate analysis passes
    activatePass(1);
    updateProgress(10, '🎭 Demo Mode: Simulating visual scan...');
    await sleep(800);
    completePass(1);

    activatePass(2);
    updateProgress(35, '🎭 Demo Mode: Performing deep WCAG audit...');
    await sleep(1000);
    completePass(2);

    activatePass(3);
    updateProgress(65, '🎭 Demo Mode: Generating remediation code...');
    await sleep(800);
    completePass(3);

    activatePass(4);
    updateProgress(90, '🎭 Demo Mode: Compiling executive summary...');
    await sleep(600);
    completePass(4);
    updateProgress(100, 'Demo analysis complete!');

    await sleep(400);

    const demoResults = getDemoResults();
    state.analysisResults = demoResults;
    renderResults(demoResults);
    showToast('Demo analysis loaded! Explore the results below.', 'success');
}

function getDemoResults() {
    return {
        issues: [
            {
                id: 0, category: 'contrast', severity: 'critical',
                title: 'Insufficient text contrast on hero banner',
                description: 'The white text overlaid on the light-colored hero banner image has a contrast ratio of approximately 2.1:1, falling significantly below the WCAG 2.1 Level AA minimum of 4.5:1 for normal text. This makes the text nearly illegible for users with low vision or color deficiencies.',
                wcag_criterion: 'WCAG 1.4.3',
                affected_users: 'Users with low vision, color blindness, or viewing in bright environments',
                location: 'Hero banner section at the top of the page',
                confidence: 0.95,
                code_fix: `.hero-banner {\n  position: relative;\n}\n\n.hero-banner::after {\n  content: '';\n  position: absolute;\n  inset: 0;\n  background: linear-gradient(\n    to bottom,\n    rgba(0, 0, 0, 0.6),\n    rgba(0, 0, 0, 0.3)\n  );\n}\n\n.hero-text {\n  position: relative;\n  z-index: 1;\n  color: #ffffff;\n  text-shadow: 0 2px 4px rgba(0,0,0,0.3);\n}`,
            },
            {
                id: 1, category: 'contrast', severity: 'major',
                title: 'Low contrast placeholder text in search bar',
                description: 'The placeholder text in the search input field uses a light gray (#ccc) on white background, resulting in a contrast ratio of about 1.6:1. Placeholder text should meet at least 3:1 contrast ratio per WCAG 1.4.11 for non-text contrast.',
                wcag_criterion: 'WCAG 1.4.11',
                affected_users: 'Users with low vision, elderly users',
                location: 'Search bar in the navigation header',
                confidence: 0.88,
                code_fix: `input::placeholder {\n  color: #767676; /* 4.5:1 contrast ratio */\n  opacity: 1;\n}`,
            },
            {
                id: 2, category: 'typography', severity: 'major',
                title: 'Footer text too small to read comfortably',
                description: 'Multiple text elements in the footer section appear to be below 12px font size. Small text reduces readability for all users and particularly impacts those with visual impairments. WCAG recommends a minimum font size that users can resize up to 200% without loss of content.',
                wcag_criterion: 'WCAG 1.4.4',
                affected_users: 'Users with low vision, elderly users, mobile users',
                location: 'Footer section at the bottom of the page',
                confidence: 0.82,
                code_fix: `.footer {\n  font-size: clamp(0.875rem, 2vw, 1rem);\n  line-height: 1.6;\n}\n\n.footer-links a {\n  font-size: inherit;\n  padding: 4px 0; /* Increased touch target */\n}`,
            },
            {
                id: 3, category: 'typography', severity: 'minor',
                title: 'Insufficient line spacing in product descriptions',
                description: 'Product description text blocks appear to have tight line spacing (approximately 1.2), making it harder to track lines when reading. WCAG 1.4.12 recommends line height of at least 1.5 times the font size for readability.',
                wcag_criterion: 'WCAG 1.4.12',
                affected_users: 'Users with cognitive disabilities, dyslexia, low vision',
                location: 'Product cards throughout the main content area',
                confidence: 0.78,
                code_fix: `.product-description {\n  line-height: 1.6;\n  letter-spacing: 0.012em;\n  word-spacing: 0.05em;\n  max-width: 65ch; /* Optimal reading width */\n}`,
            },
            {
                id: 4, category: 'navigation', severity: 'critical',
                title: 'No visible heading hierarchy',
                description: 'The page appears to lack a clear visual heading hierarchy. Without properly structured headings (H1 through H6), screen reader users cannot quickly navigate the page structure, and sighted users may struggle to scan content effectively.',
                wcag_criterion: 'WCAG 1.3.1',
                affected_users: 'Screen reader users, users with cognitive disabilities, keyboard-only users',
                location: 'Entire page structure',
                confidence: 0.85,
                code_fix: `/* Establish clear visual hierarchy */\nh1 {\n  font-size: 2.5rem;\n  font-weight: 800;\n  margin-bottom: 1rem;\n}\n\nh2 {\n  font-size: 1.75rem;\n  font-weight: 700;\n  margin-top: 2rem;\n}\n\nh3 {\n  font-size: 1.25rem;\n  font-weight: 600;\n}\n\n/* Add skip navigation link */\n.skip-link {\n  position: absolute;\n  top: -40px;\n  left: 0;\n  padding: 8px 16px;\n  background: #000;\n  color: #fff;\n  z-index: 1000;\n}\n\n.skip-link:focus {\n  top: 0;\n}`,
            },
            {
                id: 5, category: 'navigation', severity: 'minor',
                title: 'No visible skip navigation link',
                description: 'There is no visible "Skip to main content" link that appears on keyboard focus. This forces keyboard and screen reader users to tab through the entire navigation on every page load.',
                wcag_criterion: 'WCAG 2.4.1',
                affected_users: 'Keyboard-only users, screen reader users',
                location: 'Top of the page (missing element)',
                confidence: 0.90,
                code_fix: `<!-- Add as first element in body -->\n<a href="#main-content" class="skip-link">\n  Skip to main content\n</a>\n\n<style>\n.skip-link {\n  position: absolute;\n  top: -100%;\n  left: 16px;\n  padding: 12px 24px;\n  background: #1a1a1a;\n  color: #fff;\n  border-radius: 0 0 8px 8px;\n  font-weight: 600;\n  z-index: 10000;\n  transition: top 0.2s;\n}\n.skip-link:focus {\n  top: 0;\n}\n</style>`,
            },
            {
                id: 6, category: 'forms', severity: 'major',
                title: 'Search input lacks visible label',
                description: 'The search input field relies solely on a placeholder for labeling. Placeholders disappear on focus, leaving users unsure of the field\'s purpose. A persistent visible label or an aria-label is required.',
                wcag_criterion: 'WCAG 1.3.1',
                affected_users: 'Screen reader users, users with cognitive disabilities, users with short-term memory issues',
                location: 'Search bar in the header navigation',
                confidence: 0.92,
                code_fix: `<!-- Option 1: Visible label -->\n<label for="search-input" class="search-label">\n  Search products\n</label>\n<input id="search-input" type="search"\n  placeholder="e.g., wireless headphones">\n\n<!-- Option 2: Visually hidden label -->\n<label for="search-input" class="sr-only">\n  Search products\n</label>\n\n<style>\n.sr-only {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  padding: 0;\n  margin: -1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n  border: 0;\n}\n</style>`,
            },
            {
                id: 7, category: 'forms', severity: 'minor',
                title: 'Newsletter signup lacks error validation feedback',
                description: 'The email signup form in the footer does not appear to have visible error states or validation messages. Users who enter invalid data may not receive clear feedback about what went wrong.',
                wcag_criterion: 'WCAG 3.3.1',
                affected_users: 'All users, especially those with cognitive disabilities',
                location: 'Newsletter signup form in the footer',
                confidence: 0.72,
                code_fix: `.form-input.error {\n  border-color: #ef4444;\n  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);\n}\n\n.error-message {\n  color: #ef4444;\n  font-size: 0.875rem;\n  margin-top: 4px;\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n\n.error-message::before {\n  content: '⚠';\n}`,
            },
            {
                id: 8, category: 'media', severity: 'major',
                title: 'Product images likely missing alt text',
                description: 'Multiple product images are displayed in a grid layout. Based on the visual pattern, these images likely lack descriptive alt text, which is essential for screen reader users to understand the product being shown.',
                wcag_criterion: 'WCAG 1.1.1',
                affected_users: 'Blind and low-vision screen reader users',
                location: 'Product grid in the main content area',
                confidence: 0.80,
                code_fix: `<!-- Descriptive alt text for product images -->\n<img src="product.jpg"\n  alt="Blue wireless headphones with\n  noise cancellation - Model XB400"\n  loading="lazy"\n  width="400"\n  height="400">\n\n<!-- For decorative images -->\n<img src="decorative-wave.svg"\n  alt="" role="presentation">`,
            },
            {
                id: 9, category: 'media', severity: 'best_practice',
                title: 'Text rendered as image in promotional banner',
                description: 'A promotional banner appears to contain text rendered as part of the image rather than as actual HTML text. This prevents screen readers from reading the content, search engines from indexing it, and users from resizing the text.',
                wcag_criterion: 'WCAG 1.4.5',
                affected_users: 'Screen reader users, users who enlarge text, search engine crawlers',
                location: 'Promotional banner in the middle of the page',
                confidence: 0.75,
                code_fix: `<!-- Replace image text with HTML overlay -->\n<div class="promo-banner" role="banner">\n  <img src="banner-bg.jpg" alt="" role="presentation">\n  <div class="promo-content">\n    <h2>Summer Sale - Up to 50% Off</h2>\n    <p>Use code SUMMER50 at checkout</p>\n    <a href="/sale" class="promo-cta">Shop Now</a>\n  </div>\n</div>`,
            },
            {
                id: 10, category: 'responsive', severity: 'major',
                title: 'Navigation links have small touch targets',
                description: 'The navigation menu links appear to have touch targets smaller than the recommended 44×44 CSS pixels. Small touch targets make the site difficult to use on mobile devices, especially for users with motor impairments.',
                wcag_criterion: 'WCAG 2.5.5',
                affected_users: 'Mobile users, users with motor impairments, elderly users',
                location: 'Main navigation bar',
                confidence: 0.83,
                code_fix: `nav a {\n  display: inline-flex;\n  align-items: center;\n  min-height: 44px;\n  min-width: 44px;\n  padding: 12px 16px;\n}\n\n/* Ensure spacing between targets */\nnav li + li {\n  margin-left: 4px;\n}`,
            },
            {
                id: 11, category: 'responsive', severity: 'minor',
                title: 'Content may not reflow properly at narrow widths',
                description: 'The page layout appears to use fixed-width elements that may not properly reflow when the viewport is narrowed or zoom is increased to 400%. This can cause horizontal scrolling and content being cut off.',
                wcag_criterion: 'WCAG 1.4.10',
                affected_users: 'Users who zoom, mobile users, users with low vision',
                location: 'Product grid and main content areas',
                confidence: 0.70,
                code_fix: `.product-grid {\n  display: grid;\n  grid-template-columns: repeat(\n    auto-fill,\n    minmax(min(280px, 100%), 1fr)\n  );\n  gap: 24px;\n}\n\n/* Ensure images are responsive */\nimg {\n  max-width: 100%;\n  height: auto;\n}\n\n/* Prevent horizontal overflow */\n.container {\n  max-width: 100%;\n  overflow-x: hidden;\n}`,
            },
        ],
        summary: {
            overall_score: 42,
            category_scores: {
                contrast: 35,
                typography: 55,
                navigation: 40,
                forms: 45,
                media: 38,
                responsive: 50,
            },
            summary_text: 'This e-commerce website shows several significant accessibility barriers that would prevent many users with disabilities from effectively using the site. The most critical issues involve insufficient color contrast on the hero banner (ratio of 2.1:1 vs the required 4.5:1) and a lack of clear heading hierarchy, both of which are foundational accessibility requirements.\n\nThe site also has notable issues in forms (missing labels), media (missing alt text on product images), and navigation (no skip link). While the visual design is modern, it prioritizes aesthetics over inclusivity. With targeted remediation focusing on the critical and major issues first, the site could reach a reasonable level of WCAG 2.1 AA compliance within a few days of development effort.',
            top_priorities: [
                'Fix hero banner contrast ratio — add a dark overlay to achieve minimum 4.5:1 ratio for all text on image backgrounds',
                'Add descriptive alt text to all product images — each should describe the product name, color, and key visual features',
                'Implement proper heading hierarchy (H1→H6) and add a skip navigation link for keyboard users',
            ],
            estimated_effort: 'Medium',
            effort_hours: '8-16h',
            positive_findings: 'The site uses a clean, modern layout with consistent spacing. The navigation is visually organized, and the overall structure follows common e-commerce patterns that most users will find familiar.',
        },
        timestamp: Date.now(),
        fileName: 'demo-ecommerce-site.png',
        model: 'gemma-4-27b-it (Demo)',
    };
}

// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('exit');
        setTimeout(() => toast.remove(), 300);
    }, CONFIG.TOAST_DURATION);
}

// ===== UTILITIES =====
function showSection(id) {
    const el = $(`#${id}`);
    if (el) {
        el.classList.remove('hidden');
        el.classList.add('slide-up');
    }
}

function hideSection(id) {
    const el = $(`#${id}`);
    if (el) {
        el.classList.add('hidden');
        el.classList.remove('slide-up');
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getScoreColor(score) {
    if (score >= 90) return '#10b981';
    if (score >= 70) return '#3b82f6';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
}

function animateValue(el, start, end, duration) {
    const range = end - start;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(start + range * eased);
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
