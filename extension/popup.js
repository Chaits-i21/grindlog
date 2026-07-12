const $ = (id) => document.getElementById(id);

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function render() {
  const cfg = await chrome.storage.sync.get(['token', 'owner', 'repo', 'branch']);
  if (cfg.token && cfg.owner && cfg.repo) {
    $('config').innerHTML =
      `<span class="ok">✔ Configured</span> — <a href="https://github.com/${esc(cfg.owner)}/${esc(cfg.repo)}" target="_blank">${esc(cfg.owner)}/${esc(cfg.repo)}</a>`;
  } else {
    $('config').innerHTML = '<span class="err">✖ Not configured</span> — open settings.';
  }

  const { lastPush } = await chrome.storage.local.get('lastPush');
  if (lastPush) {
    const when = new Date(lastPush.at).toLocaleString();
    if (lastPush.ok && lastPush.skipped) {
      $('last').innerHTML = `Last: <b>${esc(lastPush.title)}</b> — duplicate, skipped<br><small>${when}</small>`;
    } else if (lastPush.ok) {
      $('last').innerHTML =
        `Last push: <a href="${esc(lastPush.url)}" target="_blank"><b>${esc(lastPush.title)}</b></a> ✔<br><small>${when}</small>`;
    } else {
      $('last').innerHTML = `<span class="err">Last push failed:</span> ${esc(lastPush.title)}<br><small>${when}</small>`;
    }
  } else {
    $('last').textContent = 'No pushes yet — solve something!';
  }

  const resp = await chrome.runtime.sendMessage({ type: 'GET_QUEUE_COUNT' });
  if (resp && resp.count > 0) {
    $('queue').innerHTML = `<span class="err">${resp.count} push(es) queued</span> — retrying every 5 min.`;
  } else {
    $('queue').textContent = '';
  }
}

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
render();
