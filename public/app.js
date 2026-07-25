(function () {
  'use strict';

  var STORAGE_KEY = 'pocketplan.session.v1';
  var HISTORY_KEY = 'pocketplan.history.v1';

  var dom = {
    mode: document.getElementById('mode'),
    budget: document.getElementById('budget'),
    ownedItems: document.getElementById('ownedItems'),
    occasion: document.getElementById('occasion'),
    time: document.getElementById('time'),
    constraints: document.getElementById('constraints'),
    planBtn: document.getElementById('planBtn'),
    clearBtn: document.getElementById('clearBtn'),
    emergencyBanner: document.getElementById('emergencyBanner'),
    result: document.getElementById('result'),
    budgetBarFill: document.getElementById('budgetBarFill'),
    budgetUsed: document.getElementById('budgetUsed'),
    budgetTotal: document.getElementById('budgetTotal'),
    zeroWasteScore: document.getElementById('zeroWasteScore'),
    optionCount: document.getElementById('optionCount'),
    warnings: document.getElementById('warnings'),
    missingItems: document.getElementById('missingItems'),
    options: document.getElementById('options'),
    publicDecisionTrace: document.getElementById('publicDecisionTrace'),
    fallbackNotice: document.getElementById('fallbackNotice')
  };

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.mode) dom.mode.value = s.mode;
      if (typeof s.budget === 'number') dom.budget.value = s.budget;
      if (Array.isArray(s.ownedItems)) dom.ownedItems.value = s.ownedItems.join(', ');
      if (s.occasion) dom.occasion.value = s.occasion;
      if (typeof s.time === 'number') dom.time.value = s.time;
      if (Array.isArray(s.constraints)) dom.constraints.value = s.constraints.join(', ');
    } catch (e) {}
  }

  function getHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var history = raw ? JSON.parse(raw) : [];
      return Array.isArray(history) ? history : [];
    } catch (e) {
      return [];
    }
  }

  function loadHistory() {
    var history = getHistory();
    if (history.length > 0 && history[0] && history[0].plan) {
      render(history[0].plan);
    }
  }

  function saveSession() {
    try {
      var session = {
        mode: dom.mode.value,
        budget: Number(dom.budget.value),
        ownedItems: dom.ownedItems.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        occasion: dom.occasion.value,
        time: Number(dom.time.value),
        constraints: dom.constraints.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch (e) {}
  }

  function saveHistory(plan, input) {
    try {
      var history = getHistory();
      history.unshift({ ts: Date.now(), input: input, plan: plan });
      if (history.length > 20) history.length = 20;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {}
  }

  function clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(HISTORY_KEY);
    } catch (e) {}
    dom.mode.value = 'meal';
    dom.budget.value = '20';
    dom.ownedItems.value = '';
    dom.occasion.value = 'daily';
    dom.time.value = '30';
    dom.constraints.value = '';
    dom.result.classList.add('hidden');
    dom.emergencyBanner.classList.add('hidden');
    dom.fallbackNotice.classList.add('hidden');
    dom.warnings.innerHTML = '';
    dom.missingItems.innerHTML = '';
    dom.options.innerHTML = '';
    dom.publicDecisionTrace.innerHTML = '';
  }

  function render(plan) {
    dom.budgetTotal.textContent = plan.budgetTotal;
    dom.budgetUsed.textContent = Number(plan.budgetUsed).toFixed(2);
    var pct = plan.budgetTotal > 0 ? (plan.budgetUsed / plan.budgetTotal) * 100 : 0;
    dom.budgetBarFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    dom.budgetBarFill.classList.remove('warn', 'critical');
    if (pct > 100) dom.budgetBarFill.classList.add('critical');
    else if (pct > 80) dom.budgetBarFill.classList.add('warn');

    dom.zeroWasteScore.textContent = Number(plan.zeroWasteScore).toFixed(0);
    dom.optionCount.textContent = plan.options.length;

    if (plan.emergencyBanner && plan.emergencyBanner.active) {
      dom.emergencyBanner.textContent = plan.emergencyBanner.message || 'Critical constraints detected.';
      dom.emergencyBanner.classList.remove('hidden');
    } else {
      dom.emergencyBanner.classList.add('hidden');
    }

    dom.warnings.innerHTML = '';
    if (plan.warnings && plan.warnings.length > 0) {
      plan.warnings.forEach(function (w) {
        var div = document.createElement('div');
        div.className = 'warning ' + w.severity;
        div.textContent = w.message;
        dom.warnings.appendChild(div);
      });
    }

    dom.missingItems.innerHTML = '';
    if (plan.missingItems && plan.missingItems.length > 0) {
      var heading = document.createElement('div');
      heading.innerHTML = '<strong>Missing items:</strong>';
      dom.missingItems.appendChild(heading);
      plan.missingItems.forEach(function (m) {
        var chip = document.createElement('span');
        chip.className = 'missing-item';
        chip.textContent = m.name + ' (~' + Number(m.estimatedCost).toFixed(2) + ')';
        dom.missingItems.appendChild(chip);
      });
    }

    dom.options.innerHTML = '';
    plan.options.forEach(function (opt, idx) {
      var card = document.createElement('div');
      card.className = 'option-card' + (idx === 0 ? ' best' : '');

      var title = document.createElement('div');
      title.className = 'option-title';
      title.appendChild(document.createTextNode(String(opt.title)));
      var score = document.createElement('span');
      score.className = 'option-score';
      score.textContent = 'score ' + Number(opt.score).toFixed(0);
      title.appendChild(document.createTextNode(' '));
      title.appendChild(score);

      var meta = document.createElement('div');
      meta.className = 'option-meta';
      meta.textContent = 'cost ' + Number(opt.cost).toFixed(2) + ' · time ' + opt.time + ' min';

      var itemsWrap = document.createElement('div');
      itemsWrap.className = 'option-items';
      var ul = document.createElement('ul');
      (opt.items || []).forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      });
      itemsWrap.appendChild(ul);

      var rationale = document.createElement('div');
      rationale.className = 'option-rationale';
      rationale.textContent = opt.rationale;

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(itemsWrap);
      card.appendChild(rationale);
      dom.options.appendChild(card);
    });

    dom.publicDecisionTrace.innerHTML = '';
    (plan.publicDecisionTrace || []).forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      dom.publicDecisionTrace.appendChild(li);
    });

    if (plan._fallback) {
      dom.fallbackNotice.classList.remove('hidden');
    } else {
      dom.fallbackNotice.classList.add('hidden');
    }

    dom.result.classList.remove('hidden');
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  async function plan() {
    saveSession();
    var input = {
      mode: dom.mode.value,
      budget: Number(dom.budget.value),
      ownedItems: dom.ownedItems.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      occasion: dom.occasion.value.trim(),
      time: Number(dom.time.value),
      constraints: dom.constraints.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    };

    dom.planBtn.disabled = true;
    dom.planBtn.textContent = 'Planning...';

    try {
      var response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });

      if (!response.ok) {
        var err = await response.json().catch(function () { return {}; });
        throw new Error(err.error || 'request failed');
      }

      var data = await response.json();
      var planResult = data.plan;
      planResult._fallback = !!data.fallback;
      render(planResult);
      saveHistory(planResult, input);
    } catch (err) {
      dom.warnings.innerHTML = '<div class="warning critical">Request failed: ' + escapeHtml(err.message) + '</div>';
      dom.result.classList.remove('hidden');
    } finally {
      dom.planBtn.disabled = false;
      dom.planBtn.textContent = 'Plan';
    }
  }

  dom.planBtn.addEventListener('click', plan);
  dom.clearBtn.addEventListener('click', clearAll);
  loadSession();
  loadHistory();
})();