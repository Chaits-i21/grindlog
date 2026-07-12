// Runs in the page's MAIN world (see manifest). Wraps fetch and XMLHttpRequest so we
// can see the exact code sent to /submit/ and the verdict polled from /check/.
// Communicates with content.js (isolated world) via window.postMessage.
(() => {
  const SOURCE = 'grindlog';

  // submission_id -> { code, lang, questionId, slug, submittedAt }
  const pending = new Map();
  // check/ is polled repeatedly; only emit once per submission
  const finished = new Set();

  function post(type, payload) {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  }

  function slugFromLocation() {
    const m = window.location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  function handleSubmitResponse(url, requestBody, responseJson) {
    const m = url.match(/\/problems\/([^/]+)\/submit\/?/);
    if (!m || !responseJson || responseJson.submission_id == null) return;
    let body = {};
    try {
      body = typeof requestBody === 'string' ? JSON.parse(requestBody) : {};
    } catch {
      return;
    }
    pending.set(String(responseJson.submission_id), {
      code: body.typed_code,
      lang: body.lang,
      questionId: body.question_id,
      slug: m[1],
      submittedAt: Date.now(),
    });
  }

  function handleCheckResponse(url, json) {
    const m = url.match(/\/submissions\/detail\/(\d+)\/check\/?/);
    if (!m || !json || json.state !== 'SUCCESS') return;
    const id = m[1];
    if (finished.has(id)) return;
    finished.add(id);

    const sub = pending.get(id);
    pending.delete(id);

    if (json.status_msg === 'Accepted' && sub && sub.code) {
      post('accepted', {
        submissionId: id,
        code: sub.code,
        lang: sub.lang,
        questionId: sub.questionId,
        slug: sub.slug,
        submittedAt: sub.submittedAt,
        stats: {
          runtime: json.status_runtime || null,        // e.g. "21 ms"
          memory: json.status_memory || null,          // e.g. "48.27 MB"
          runtimeBeats: json.runtime_percentile != null ? Math.round(json.runtime_percentile * 100) / 100 : null,
          memoryBeats: json.memory_percentile != null ? Math.round(json.memory_percentile * 100) / 100 : null,
        },
      });
    } else if (json.status_msg && json.status_msg !== 'Accepted') {
      // Failed submission: count it (code is discarded), used for the attempt counter.
      post('attempt', {
        slug: (sub && sub.slug) || slugFromLocation(),
        verdict: json.status_msg,
      });
    }
  }

  function isSubmitUrl(method, url) {
    return method === 'POST' && url.includes('/problems/') && /\/submit\/?(\?|$)/.test(url);
  }

  function isCheckUrl(url) {
    return url.includes('/submissions/detail/') && url.includes('/check');
  }

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const submit = isSubmitUrl(method, url);
    const check = isCheckUrl(url);
    if (!submit && !check) return origFetch.apply(this, arguments);

    // Grab the request body before dispatch; clone the response before the page
    // consumes it (our .then is registered first, so it runs first).
    const requestBodyPromise = submit
      ? (init && typeof init.body === 'string'
          ? Promise.resolve(init.body)
          : (input instanceof Request ? input.clone().text().catch(() => '') : Promise.resolve('')))
      : Promise.resolve('');

    const respPromise = origFetch.apply(this, arguments);
    respPromise.then((resp) => {
      const jsonPromise = resp.clone().json();
      if (submit) {
        Promise.all([requestBodyPromise, jsonPromise])
          .then(([body, j]) => handleSubmitResponse(url, body, j))
          .catch(() => {});
      } else {
        jsonPromise.then((j) => handleCheckResponse(url, j)).catch(() => {});
      }
    }).catch(() => {});
    return respPromise;
  };

  // --- XMLHttpRequest (axios and older code paths use XHR) ---
  const xhrProto = XMLHttpRequest.prototype;
  const origOpen = xhrProto.open;
  const origSend = xhrProto.send;

  xhrProto.open = function (method, url) {
    this.__plc = { method: String(method).toUpperCase(), url: String(url) };
    return origOpen.apply(this, arguments);
  };

  xhrProto.send = function (body) {
    const info = this.__plc;
    if (info && (isSubmitUrl(info.method, info.url) || isCheckUrl(info.url))) {
      this.addEventListener('load', () => {
        try {
          const json = JSON.parse(this.responseText);
          if (isSubmitUrl(info.method, info.url)) {
            handleSubmitResponse(info.url, typeof body === 'string' ? body : '', json);
          } else {
            handleCheckResponse(info.url, json);
          }
        } catch {
          /* non-JSON response — ignore */
        }
      });
    }
    return origSend.apply(this, arguments);
  };
})();
