// ════════════════════════════════════════════════════════════
// SecureWorks — Tool Integration Layer
//
// Drop this into any scoping tool to add cloud features:
//   - Login / auth
//   - Save to cloud / load from cloud
//   - Job picker
//   - Auto-save
//   - Online/offline indicator
//
// Detects tool type from the page title or a data attribute.
// Requires cloud.js to be loaded first.
//
// Usage (add before </body> in any tool):
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script>
//     window.SUPABASE_URL = 'https://kevgrhcjxspbxgovpmfl.supabase.co';
//     window.SUPABASE_ANON_KEY = 'eyJ...';
//   </script>
//   <script src="../shared/brand.js"></script>
//   <script src="../shared/cloud.js"></script>
//   <script src="../shared/integration.js"></script>
// ════════════════════════════════════════════════════════════

(function() {
  'use strict';

  console.log('[Integration] Script loaded');

  var cloud = null;
  var _jobId = null;
  var _ghlOpportunityId = null;
  var _toolType = null;
  var _getStateFn = null;
  var _loadStateFn = null;

  // ── Detect tool type ──
  function detectToolType() {
    var attr = document.body.dataset.toolType || document.documentElement.dataset.toolType;
    if (attr) return attr;
    var title = (document.title || '').toLowerCase();
    if (title.includes('fence') || title.includes('fencing')) return 'fencing';
    if (title.includes('patio')) return 'patio';
    return 'patio';
  }

  // ── Check URL for jobId parameter ──
  function getJobIdFromURL() {
    var params = new URLSearchParams(window.location.search);
    return params.get('jobId') || params.get('job') || null;
  }

  // ── Inject cloud bar below the header ──
  function injectToolbar() {
    var header = document.querySelector('.header') ||
                 document.querySelector('header') ||
                 document.querySelector('[class*="header"]');

    console.log('[Integration] Header found:', !!header);
    if (!header) return;

    // Inject a <style> block for cloud bar + hover states
    if (!document.getElementById('sw-cloud-styles')) {
      var style = document.createElement('style');
      style.id = 'sw-cloud-styles';
      style.textContent =
        '#sw-cloud-bar{display:flex;gap:6px;align-items:center;justify-content:flex-end;' +
          'padding:4px 24px;background:#293C46;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;' +
          'border-bottom:2px solid #F15A29;}' +
        '#sw-cloud-bar .sw-status{font-size:11px;color:rgba(255,255,255,0.6);margin-right:auto;letter-spacing:0.3px;}' +
        '#sw-cloud-bar .sw-btn{padding:3px 12px;border:1px solid rgba(255,255,255,0.25);color:#fff;' +
          'background:transparent;border-radius:3px;font-size:11px;font-weight:600;cursor:pointer;' +
          'letter-spacing:0.3px;transition:all 0.15s ease;text-transform:uppercase;}' +
        '#sw-cloud-bar .sw-btn:hover{background:rgba(255,255,255,0.12);border-color:rgba(255,255,255,0.4);}' +
        '#sw-cloud-bar .sw-btn-primary{background:#F15A29;border-color:#F15A29;}' +
        '#sw-cloud-bar .sw-btn-primary:hover{background:#d94d20;border-color:#d94d20;}' +
        '#sw-cloud-bar .sw-btn-save{background:#34C759;border-color:#34C759;}' +
        '#sw-cloud-bar .sw-btn-save:hover{background:#2ab348;}';
      document.head.appendChild(style);
    }

    // Create a dedicated cloud bar that sits below the header
    var cloudBar = document.createElement('div');
    cloudBar.id = 'sw-cloud-bar';

    cloudBar.innerHTML =
      '<span class="sw-status" id="sw-cloud-status"></span>' +
      '<button id="sw-btn-login" class="sw-btn sw-btn-primary" onclick="window._swIntegration.login()" style="display:none;">Sign In</button>' +
      '<button id="sw-btn-save" class="sw-btn sw-btn-save" onclick="window._swIntegration.save()" style="display:none;">Save</button>' +
      '<button id="sw-btn-load" class="sw-btn" onclick="window._swIntegration.loadPicker()" style="display:none;">Load Job</button>' +
      '<button id="sw-btn-dashboard" class="sw-btn" onclick="window._swIntegration.openDashboard()" style="display:none;">Dashboard</button>';

    // Insert right after the header
    if (header.nextSibling) {
      header.parentNode.insertBefore(cloudBar, header.nextSibling);
    } else {
      header.parentNode.appendChild(cloudBar);
    }

    console.log('[Integration] Cloud bar injected');
  }

  // ── Update UI based on auth state ──
  function updateUI() {
    var loginBtn = document.getElementById('sw-btn-login');
    var saveBtn = document.getElementById('sw-btn-save');
    var loadBtn = document.getElementById('sw-btn-load');
    var dashBtn = document.getElementById('sw-btn-dashboard');
    var status = document.getElementById('sw-cloud-status');

    if (!loginBtn) {
      console.warn('[Integration] updateUI: buttons not found in DOM');
      return;
    }

    if (cloud && cloud.auth.isLoggedIn()) {
      var user = cloud.auth.getUser();
      var userName = (user && user.name) || (user && user.email) || '';
      loginBtn.style.display = 'none';
      saveBtn.style.display = '';
      loadBtn.style.display = '';
      dashBtn.style.display = '';
      status.textContent = userName + (_jobId ? ' | Job loaded' : '');
      console.log('[Integration] UI updated: logged in as', userName);
    } else if (cloud) {
      loginBtn.style.display = '';
      saveBtn.style.display = 'none';
      loadBtn.style.display = 'none';
      dashBtn.style.display = 'none';
      status.textContent = 'Not signed in';
      console.log('[Integration] UI updated: not signed in, showing Sign In button');
    } else {
      loginBtn.style.display = 'none';
      saveBtn.style.display = 'none';
      loadBtn.style.display = 'none';
      dashBtn.style.display = 'none';
      status.textContent = '';
      console.log('[Integration] UI updated: no cloud module');
    }
  }

  // ════════════════════════════════════════════════════════════
  // STATE GETTERS / SETTERS  (tool-specific)
  // ════════════════════════════════════════════════════════════

  function getFencingState() {
    if (window.app && window.app.job) {
      return {
        tool: 'fencing',
        version: '1.0',
        job: window.app.job,
        scopeMedia: window.scopeMedia ? {
          photos: (window.scopeMedia.photos || []).map(function(p) {
            return { label: p.label, dataUrl: p.dataUrl };
          }),
          video: window.scopeMedia.video || null
        } : null,
        savedAt: new Date().toISOString()
      };
    }
    return null;
  }

  function loadFencingState(scopeJson) {
    if (!scopeJson || !scopeJson.job || !window.app) return false;
    try {
      window.app.job = scopeJson.job;
      if (window.app.currentRunId && window.app.job.runs.length > 0) {
        window.app.currentRunId = window.app.job.runs[0].id;
      }
      if (typeof window.app.renderAll === 'function') window.app.renderAll();
      else if (typeof window.app.render === 'function') window.app.render();
      return true;
    } catch(e) {
      console.error('[Integration] Failed to load fencing state:', e);
      return false;
    }
  }

  function getPatioState() {
    if (typeof window.gatherJobData === 'function') {
      try {
        var base = window.gatherJobData();
        return {
          tool: 'patio',
          version: '1.0',
          client: base.client,
          config: base.config,
          pricing: base.pricing,
          complexity: base.complexity,
          notes: base.notes,
          customer: window.customer || {},
          siteDetails: window.siteDetails || {},
          savedAt: new Date().toISOString()
        };
      } catch(e) {
        console.warn('[Integration] gatherJobData failed:', e);
      }
    }
    if (typeof window.saveJobData === 'function') {
      return { tool: 'patio', version: '1.0', savedAt: new Date().toISOString() };
    }
    return null;
  }

  function loadPatioState(scopeJson) {
    if (!scopeJson) return false;
    try {
      var textarea = document.getElementById('loadJobTextarea');
      if (textarea && typeof window.loadJobData === 'function') {
        textarea.value = JSON.stringify(scopeJson);
        window.loadJobData();
        var modal = document.getElementById('loadJobModal');
        if (modal) modal.style.display = 'none';
        return true;
      }
      return false;
    } catch(e) {
      console.error('[Integration] Failed to load patio state:', e);
      return false;
    }
  }

  // ════════════════════════════════════════════════════════════
  // PUBLIC API  (exposed on window for button clicks)
  // ════════════════════════════════════════════════════════════

  var integration = {
    login: function() {
      if (cloud) cloud.ui.showLoginModal();
    },

    save: async function() {
      if (!cloud || !cloud.auth.isLoggedIn()) {
        cloud.ui.showLoginModal();
        return;
      }

      var state = _getStateFn();
      if (!state) {
        alert('Nothing to save — no job data found.');
        return;
      }

      var meta = {};
      if (state.job) {
        meta.client_name = state.job.clientName || state.job.client || '';
        meta.site_suburb = state.job.suburb || '';
        meta.client_phone = state.job.phone || '';
      } else if (state.customer || state.client) {
        var c = state.customer || {};
        var cl = state.client || {};
        meta.client_name = c.name || cl.name || '';
        meta.site_suburb = cl.suburb || c.address || '';
        meta.client_phone = c.phone || cl.phone || '';
      }

      try {
        cloud.ui.showSaveStatus('saving');

        if (!_jobId) {
          var name = meta.client_name || prompt('Client name for this job:');
          if (!name) { cloud.ui.showSaveStatus('error'); return; }
          meta.client_name = name;

          var job = await cloud.jobs.createJob(_toolType, meta);
          _jobId = job.id;

          var newUrl = window.location.pathname + '?jobId=' + _jobId;
          window.history.replaceState({}, '', newUrl);
        }

        await cloud.jobs.saveJob(_jobId, state, meta);

        // Write scope link back to GHL opportunity notes
        if (_ghlOpportunityId) {
          try {
            await cloud.ghl.linkScope(_ghlOpportunityId, _jobId, _toolType);
          } catch(ghlErr) {
            console.warn('[Integration] GHL link failed (non-blocking):', ghlErr);
          }
        }

        cloud.ui.showSaveStatus('saved');
        updateUI();

      } catch(e) {
        console.error('[Integration] Save failed:', e);
        cloud.ui.showSaveStatus('error');
        alert('Save failed: ' + e.message);
      }
    },

    loadPicker: function() {
      if (!cloud || !cloud.auth.isLoggedIn()) {
        cloud.ui.showLoginModal();
        return;
      }

      // Show GHL opportunity picker (primary flow)
      cloud.ui.showGHLPicker(_toolType, async function(opp) {
        try {
          _ghlOpportunityId = opp.id;

          // Check if a Supabase job already exists for this opportunity
          var existingJob = await cloud.ghl.findJobByOpportunity(opp.id);

          if (existingJob) {
            // Load the existing linked job
            _jobId = existingJob.id;
            if (existingJob.scope_json && Object.keys(existingJob.scope_json).length > 0) {
              _loadStateFn(existingJob.scope_json);
            }
            if (existingJob.client_name) {
              var nameFields = document.querySelectorAll('#clientName, #customerName, [name="clientName"]');
              nameFields.forEach(function(f) { f.value = existingJob.client_name; });
            }
          } else {
            // Create a new Supabase job linked to this GHL opportunity
            var meta = {
              client_name: opp.contactName || opp.name || '',
              client_phone: opp.contactPhone || '',
              client_email: opp.contactEmail || ''
            };
            var job = await cloud.jobs.createJob(_toolType, meta);
            _jobId = job.id;

            // Set the ghl_opportunity_id on the job
            await cloud.supabase.from('jobs')
              .update({ ghl_opportunity_id: opp.id })
              .eq('id', _jobId);

            // Pre-fill client name in the tool
            if (meta.client_name) {
              var nameFields = document.querySelectorAll('#clientName, #customerName, [name="clientName"]');
              nameFields.forEach(function(f) { f.value = meta.client_name; });
            }
          }

          var newUrl = window.location.pathname + '?jobId=' + _jobId;
          window.history.replaceState({}, '', newUrl);
          updateUI();
          cloud.startAutoSave(_jobId, _getStateFn, 30000);

        } catch(e) {
          alert('Error loading opportunity: ' + e.message);
        }
      });
    },

    // Legacy: load from Supabase job list directly
    loadFromSupabase: function() {
      if (!cloud || !cloud.auth.isLoggedIn()) {
        cloud.ui.showLoginModal();
        return;
      }

      cloud.ui.showJobPicker(_toolType, async function(jobId) {
        try {
          var job = await cloud.jobs.loadJob(jobId);
          if (job.scope_json && Object.keys(job.scope_json).length > 0) {
            var loaded = _loadStateFn(job.scope_json);
            if (loaded) {
              _jobId = jobId;
              _ghlOpportunityId = job.ghl_opportunity_id || null;
              var newUrl = window.location.pathname + '?jobId=' + _jobId;
              window.history.replaceState({}, '', newUrl);
              updateUI();
              cloud.ui.showSaveStatus('saved');
              cloud.startAutoSave(_jobId, _getStateFn, 30000);
            } else {
              alert('Failed to load job data into the tool.');
            }
          } else {
            _jobId = jobId;
            _ghlOpportunityId = job.ghl_opportunity_id || null;
            var newUrl = window.location.pathname + '?jobId=' + _jobId;
            window.history.replaceState({}, '', newUrl);
            updateUI();

            if (job.client_name) {
              var nameFields = document.querySelectorAll('#clientName, #customerName, [name="clientName"]');
              nameFields.forEach(function(f) { f.value = job.client_name; });
            }

            cloud.startAutoSave(_jobId, _getStateFn, 30000);
          }
        } catch(e) {
          alert('Error loading job: ' + e.message);
        }
      });
    },

    openDashboard: function() {
      window.location.href = '../dashboard/index.html';
    }
  };

  window._swIntegration = integration;

  // ════════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════════

  function init() {
    console.log('[Integration] init() called');
    cloud = window.SECUREWORKS_CLOUD;
    _toolType = detectToolType();
    console.log('[Integration] Tool type:', _toolType, '| Cloud:', !!cloud);

    if (_toolType === 'fencing') {
      _getStateFn = getFencingState;
      _loadStateFn = loadFencingState;
    } else {
      _getStateFn = getPatioState;
      _loadStateFn = loadPatioState;
    }

    injectToolbar();

    if (!cloud) {
      updateUI();
      return;
    }

    cloud.on('auth:login', function() {
      updateUI();
      var urlJobId = getJobIdFromURL();
      if (urlJobId) {
        _jobId = urlJobId;
        cloud.jobs.loadJob(urlJobId).then(function(job) {
          if (job.scope_json && Object.keys(job.scope_json).length > 0) {
            _loadStateFn(job.scope_json);
          }
          _ghlOpportunityId = job.ghl_opportunity_id || null;
          cloud.startAutoSave(_jobId, _getStateFn, 30000);
          updateUI();
        }).catch(function(e) {
          console.warn('[Integration] Failed to auto-load job:', e);
        });
      }
    });

    cloud.on('auth:logout', function() {
      _jobId = null;
      _ghlOpportunityId = null;
      cloud.stopAutoSave();
      updateUI();
    });

    cloud.on('autosave:success', function() {
      cloud.ui.showSaveStatus('saved');
    });
    cloud.on('autosave:error', function() {
      cloud.ui.showSaveStatus('error');
    });

    cloud.on('online', function() {
      var el = document.getElementById('sw-cloud-status');
      if (el) el.textContent = el.textContent.replace(' (offline)', '');
    });
    cloud.on('offline', function() {
      var el = document.getElementById('sw-cloud-status');
      if (el && !el.textContent.includes('offline')) {
        el.textContent += ' (offline)';
      }
    });

    updateUI();

    if (cloud.auth.isLoggedIn()) {
      var urlJobId = getJobIdFromURL();
      if (urlJobId) {
        _jobId = urlJobId;
        cloud.jobs.loadJob(urlJobId).then(function(job) {
          if (job.scope_json && Object.keys(job.scope_json).length > 0) {
            _loadStateFn(job.scope_json);
          }
          _ghlOpportunityId = job.ghl_opportunity_id || null;
          cloud.startAutoSave(_jobId, _getStateFn, 30000);
          updateUI();
        }).catch(function() {});
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init, 200); });
  } else {
    setTimeout(init, 200);
  }

})();
