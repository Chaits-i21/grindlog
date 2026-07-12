const $ = (id) => document.getElementById(id);
const statusEl = $('status');

function setStatus(msg, ok) {
  statusEl.textContent = msg;
  statusEl.className = ok ? 'ok' : 'err';
}

async function load() {
  const cfg = await chrome.storage.sync.get(['token', 'owner', 'repo', 'branch']);
  if (cfg.token) $('token').value = cfg.token;
  if (cfg.owner) $('owner').value = cfg.owner;
  if (cfg.repo) $('repo').value = cfg.repo;
  if (cfg.branch) $('branch').value = cfg.branch;
}

$('save').addEventListener('click', async () => {
  const cfg = {
    token: $('token').value.trim(),
    owner: $('owner').value.trim(),
    repo: $('repo').value.trim(),
    branch: $('branch').value.trim() || 'main',
  };
  if (!cfg.token || !cfg.owner || !cfg.repo) {
    setStatus('Token, username and repository are all required.', false);
    return;
  }
  await chrome.storage.sync.set(cfg);
  setStatus('Saved — testing connection…', true);
  const resp = await chrome.runtime.sendMessage({ type: 'TEST_CONNECTION' });
  if (resp && resp.ok) {
    setStatus(`Connected to ${resp.repo} (${resp.private ? 'private' : 'public'}). 🎉`, true);
    $('done-step').classList.remove('hidden');
    $('done-step').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    setStatus(`Connection failed: ${resp ? resp.error : 'no response'}\nDouble-check the token scope (Contents: Read and write) and repo name.`, false);
  }
});

$('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
